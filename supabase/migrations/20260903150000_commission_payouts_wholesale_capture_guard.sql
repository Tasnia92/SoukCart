-- 5. Commission rate, seller ledger, admin payout.
-- 6. Refuse capture on superseded/expired checkouts (leftover gateway tab).
-- 7. Wholesale listing: MOQ, hide OOS in catalog, approved suppliers only.

-- ---------------------------------------------------------------------------
-- 6. Capture guard: only unpaid orders can become paid.
-- A leftover SSLCommerz tab for a superseded/expired tran_id must not mark
-- the failed order paid and re-reserve stock alongside the replacement order.
-- ---------------------------------------------------------------------------

create or replace function public.handle_order_inventory_reservation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  should_reserve boolean;
begin
  if old.payment_status = 'paid' and new.payment_status <> 'paid' then
    raise exception 'A paid order payment status cannot be downgraded.';
  end if;

  if new.payment_status = 'paid'
    and old.payment_status is distinct from 'unpaid'
    and old.payment_status is distinct from 'paid'
  then
    raise exception 'This checkout is no longer valid. A leftover or expired payment cannot be captured.';
  end if;

  should_reserve := new.status <> 'cancelled'
    and not (
      new.payment_method = 'online'
      and new.payment_status in ('failed', 'cancelled')
    );

  if old.stock_reserved and not should_reserve then
    perform public.apply_order_inventory_delta(new.id, 1);
    new.stock_reserved := false;
  elsif not old.stock_reserved and should_reserve then
    perform public.apply_order_inventory_delta(new.id, -1);
    new.stock_reserved := true;
  end if;

  return new;
end;
$$;

revoke execute on function public.handle_order_inventory_reservation()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Wholesale listing rules
-- ---------------------------------------------------------------------------

alter table public.products
  add column if not exists min_order_qty integer not null default 1;

alter table public.products
  drop constraint if exists products_min_order_qty_check;

alter table public.products
  add constraint products_min_order_qty_check check (min_order_qty >= 1);

create or replace function public.enforce_supplier_product_values()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.price is null or new.price <= 0 then
    raise exception 'Product price must be greater than zero.';
  end if;

  if new.min_order_qty is null or new.min_order_qty < 1 then
    raise exception 'Minimum order quantity must be at least 1.';
  end if;

  if tg_op = 'INSERT' and new.stock < 1 then
    raise exception 'A new product must have at least one unit in stock.';
  end if;

  if tg_op = 'INSERT' and new.stock < new.min_order_qty then
    raise exception 'A new product must have at least the minimum order quantity in stock.';
  end if;

  if tg_op = 'UPDATE'
    and new.stock is distinct from old.stock
    and (select auth.uid()) is not null
    and (select auth.uid()) = old.seller_id
    and new.stock < 0
  then
    raise exception 'Supplier stock cannot be negative.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_supplier_product_values()
from public, anon, authenticated;

drop policy if exists products_read on public.products;

create policy products_read
on public.products
for select
to authenticated
using (
  is_active
  and exists (
    select 1
    from public.supplier_profiles as profile
    where profile.user_id = products.seller_id
      and profile.status = 'approved'
  )
);

create or replace function public.create_order_from_cart(
  p_retailer_id uuid,
  p_notes text,
  p_payment_method text,
  p_phone text,
  p_address text,
  p_city text,
  p_postcode text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_order_id uuid;
  invalid_product text;
  moq_product text;
  moq_qty integer;
  order_total numeric;
  cart_snapshot jsonb;
  supplier_count integer;
  result jsonb;
  delivery_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  delivery_address text := nullif(btrim(coalesce(p_address, '')), '');
  delivery_city text := nullif(btrim(coalesce(p_city, '')), '');
  delivery_postcode text := nullif(btrim(coalesce(p_postcode, '')), '');
begin
  if p_retailer_id is null or not exists (
    select 1
    from public.users as account
    where account.id = p_retailer_id and account.role = 'retailer'
  ) then
    raise exception 'A retailer account is required to place an order.';
  end if;

  if p_payment_method not in ('online', 'cod') then
    raise exception 'Choose a valid payment method.';
  end if;

  if delivery_phone is null
    or delivery_address is null
    or delivery_city is null
    or delivery_postcode is null
  then
    raise exception 'Enter your phone number, delivery address, city, and postcode.';
  end if;

  update public.orders
  set payment_status = 'failed'
  where retailer_id = p_retailer_id
    and payment_method = 'online'
    and payment_status = 'unpaid'
    and status <> 'cancelled'
    and stock_reserved = true;

  select jsonb_agg(
    jsonb_build_object(
      'product_id', cart.product_id,
      'quantity', cart.quantity
    )
    order by cart.product_id
  )
  into cart_snapshot
  from public.cart_items as cart
  where cart.user_id = p_retailer_id;

  if cart_snapshot is null or jsonb_array_length(cart_snapshot) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  perform product.id
  from public.products as product
  join jsonb_to_recordset(cart_snapshot) as cart(product_id uuid, quantity integer)
    on cart.product_id = product.id
  order by product.id
  for update of product;

  select count(distinct product.seller_id)
  into supplier_count
  from jsonb_to_recordset(cart_snapshot) as cart(product_id uuid, quantity integer)
  join public.products as product on product.id = cart.product_id;

  if coalesce(supplier_count, 0) > 1 then
    raise exception 'Checkout one supplier at a time. Remove items from other suppliers first.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(cart_snapshot) as cart(product_id uuid, quantity integer)
    join public.products as product on product.id = cart.product_id
    where product.seller_id is null
      or not exists (
        select 1
        from public.supplier_profiles as profile
        where profile.user_id = product.seller_id
          and profile.status = 'approved'
      )
  ) then
    raise exception 'This supplier is not available for orders.';
  end if;

  select product.name, product.min_order_qty
  into moq_product, moq_qty
  from jsonb_to_recordset(cart_snapshot) as cart(product_id uuid, quantity integer)
  join public.products as product on product.id = cart.product_id
  where cart.quantity < product.min_order_qty
  limit 1;

  if moq_product is not null then
    raise exception 'Order at least % units of %.', moq_qty, moq_product;
  end if;

  select coalesce(product.name, 'A product')
  into invalid_product
  from jsonb_to_recordset(cart_snapshot) as cart(product_id uuid, quantity integer)
  left join public.products as product on product.id = cart.product_id
  where product.id is null
    or cart.quantity <= 0
    or not product.is_active
    or product.price <= 0
    or product.stock < cart.quantity
  limit 1;

  if invalid_product is not null then
    raise exception '% is unavailable in the requested quantity.', invalid_product;
  end if;

  select round(sum(product.price * cart.quantity), 2)
  into order_total
  from jsonb_to_recordset(cart_snapshot) as cart(product_id uuid, quantity integer)
  join public.products as product on product.id = cart.product_id;

  if order_total is null or order_total < 10 then
    raise exception 'The order total must be at least 10.00 BDT.';
  end if;

  insert into public.orders (
    retailer_id,
    status,
    payment_status,
    payment_method,
    notes,
    stock_reserved,
    delivery_phone,
    delivery_address,
    delivery_city,
    delivery_postcode
  )
  values (
    p_retailer_id,
    'pending',
    'unpaid',
    p_payment_method,
    nullif(btrim(p_notes), ''),
    true,
    delivery_phone,
    delivery_address,
    delivery_city,
    delivery_postcode
  )
  returning id into new_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price)
  select new_order_id, product.id, cart.quantity, product.price
  from jsonb_to_recordset(cart_snapshot) as cart(product_id uuid, quantity integer)
  join public.products as product on product.id = cart.product_id;

  perform public.apply_order_inventory_delta(new_order_id, -1);

  select jsonb_build_object(
    'orderId', new_order_id,
    'total', order_total,
    'lines', jsonb_agg(
      jsonb_build_object(
        'product_id', product.id,
        'product_name', product.name,
        'quantity', item.quantity,
        'price', item.unit_price
      )
      order by product.name
    )
  )
  into result
  from public.order_items as item
  join public.products as product on product.id = item.product_id
  where item.order_id = new_order_id;

  return result;
end;
$$;

revoke execute on function public.create_order_from_cart(uuid, text, text, text, text, text, text)
from public, anon, authenticated;

grant execute on function public.create_order_from_cart(uuid, text, text, text, text, text, text)
to service_role;

-- ---------------------------------------------------------------------------
-- 5. Commission + seller ledger + admin payout
-- ---------------------------------------------------------------------------

create table if not exists public.platform_settings (
  id text primary key default 'default',
  commission_rate numeric(5, 4) not null default 0.0500
    check (commission_rate >= 0 and commission_rate < 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id)
);

insert into public.platform_settings (id, commission_rate)
values ('default', 0.0500)
on conflict (id) do nothing;

create table if not exists public.commission_rate_history (
  id uuid primary key default gen_random_uuid(),
  rate numeric(5, 4) not null,
  set_by uuid not null references public.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.seller_payouts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.users (id),
  order_id uuid not null references public.orders (id) on delete cascade,
  gross numeric(12, 2) not null check (gross >= 0),
  commission_rate numeric(5, 4) not null check (commission_rate >= 0 and commission_rate < 1),
  commission_amount numeric(12, 2) not null check (commission_amount >= 0),
  net_payable numeric(12, 2) not null check (net_payable >= 0),
  status text not null check (status in ('available', 'paid', 'reversed')),
  accrued_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid references public.users (id),
  reversed_at timestamptz,
  unique (seller_id, order_id)
);

create index if not exists seller_payouts_seller_status_idx
  on public.seller_payouts (seller_id, status);

create index if not exists seller_payouts_order_idx
  on public.seller_payouts (order_id);

alter table public.platform_settings enable row level security;
alter table public.commission_rate_history enable row level security;
alter table public.seller_payouts enable row level security;

revoke all on table public.platform_settings from public, anon, authenticated;
revoke all on table public.commission_rate_history from public, anon, authenticated;
revoke all on table public.seller_payouts from public, anon, authenticated;

create or replace function public.accrue_seller_payouts_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  placed_order public.orders%rowtype;
  applied_rate numeric(5, 4);
begin
  select *
  into placed_order
  from public.orders
  where id = p_order_id;

  if placed_order.id is null
    or placed_order.status is distinct from 'delivered'
    or placed_order.payment_status is distinct from 'paid'
    or placed_order.status = 'cancelled'
  then
    return;
  end if;

  select commission_rate
  into applied_rate
  from public.platform_settings
  where id = 'default';

  if applied_rate is null then
    applied_rate := 0;
  end if;

  insert into public.seller_payouts (
    seller_id,
    order_id,
    gross,
    commission_rate,
    commission_amount,
    net_payable,
    status
  )
  select
    product.seller_id,
    p_order_id,
    round(sum(item.quantity * item.unit_price), 2),
    applied_rate,
    round(round(sum(item.quantity * item.unit_price), 2) * applied_rate, 2),
    round(
      round(sum(item.quantity * item.unit_price), 2)
      - round(round(sum(item.quantity * item.unit_price), 2) * applied_rate, 2),
      2
    ),
    'available'
  from public.order_items as item
  join public.products as product on product.id = item.product_id
  where item.order_id = p_order_id
    and product.seller_id is not null
  group by product.seller_id
  having round(sum(item.quantity * item.unit_price), 2) > 0
  on conflict (seller_id, order_id) do nothing;
end;
$$;

create or replace function public.reverse_seller_payouts_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.seller_payouts
  set status = 'reversed',
      reversed_at = now()
  where order_id = p_order_id
    and status = 'available';
end;
$$;

create or replace function public.sync_seller_payouts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' then
    perform public.reverse_seller_payouts_for_order(new.id);
  elsif new.status = 'delivered' and new.payment_status = 'paid' then
    perform public.accrue_seller_payouts_for_order(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_sync_seller_payouts on public.orders;

create trigger orders_sync_seller_payouts
after update of status, payment_status on public.orders
for each row
execute function public.sync_seller_payouts();

revoke execute on function public.accrue_seller_payouts_for_order(uuid)
from public, anon, authenticated;

revoke execute on function public.reverse_seller_payouts_for_order(uuid)
from public, anon, authenticated;

revoke execute on function public.sync_seller_payouts()
from public, anon, authenticated;

create or replace function public.admin_set_commission_rate(p_rate numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_id uuid := (select auth.uid());
  applied numeric(5, 4);
begin
  if admin_id is null or not exists (
    select 1
    from public.users as account
    where account.id = admin_id and account.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;

  if p_rate is null or p_rate < 0 or p_rate >= 1 then
    raise exception 'Commission rate must be 0%% or more and less than 100%%.';
  end if;

  applied := round(p_rate, 4);

  update public.platform_settings
  set commission_rate = applied,
      updated_at = now(),
      updated_by = admin_id
  where id = 'default';

  insert into public.commission_rate_history (rate, set_by)
  values (applied, admin_id);

  return applied;
end;
$$;

revoke execute on function public.admin_set_commission_rate(numeric)
from public, anon;

grant execute on function public.admin_set_commission_rate(numeric)
to authenticated;

create or replace function public.admin_payout_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  admin_id uuid := (select auth.uid());
  current_rate numeric(5, 4);
begin
  if admin_id is null or not exists (
    select 1
    from public.users as account
    where account.id = admin_id and account.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;

  select commission_rate
  into current_rate
  from public.platform_settings
  where id = 'default';

  return jsonb_build_object(
    'commissionRate', coalesce(current_rate, 0),
    'commissionEarned', (
      select coalesce(sum(payout.commission_amount), 0)
      from public.seller_payouts as payout
      where payout.status in ('available', 'paid')
    ),
    'pendingPayout', (
      select coalesce(sum(payout.net_payable), 0)
      from public.seller_payouts as payout
      where payout.status = 'available'
    ),
    'paidOut', (
      select coalesce(sum(payout.net_payable), 0)
      from public.seller_payouts as payout
      where payout.status = 'paid'
    ),
    'sellers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'sellerId', grouped.seller_id,
          'sellerName', grouped.seller_name,
          'sellerEmail', grouped.seller_email,
          'available', grouped.available,
          'paid', grouped.paid,
          'lastPaidAt', grouped.last_paid_at
        )
        order by grouped.available desc, grouped.seller_name
      )
      from (
        select
          seller.id as seller_id,
          seller.name as seller_name,
          seller.email as seller_email,
          coalesce(sum(payout.net_payable) filter (where payout.status = 'available'), 0) as available,
          coalesce(sum(payout.net_payable) filter (where payout.status = 'paid'), 0) as paid,
          max(payout.paid_at) as last_paid_at
        from public.seller_payouts as payout
        join public.users as seller on seller.id = payout.seller_id
        group by seller.id, seller.name, seller.email
      ) as grouped
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(recent_row order by accrued_at desc)
      from (
        select jsonb_build_object(
          'id', payout.id,
          'sellerId', payout.seller_id,
          'sellerName', seller.name,
          'orderId', payout.order_id,
          'gross', payout.gross,
          'commissionRate', payout.commission_rate,
          'commissionAmount', payout.commission_amount,
          'netPayable', payout.net_payable,
          'status', payout.status,
          'accruedAt', payout.accrued_at,
          'paidAt', payout.paid_at
        ) as recent_row,
        payout.accrued_at
        from public.seller_payouts as payout
        join public.users as seller on seller.id = payout.seller_id
        order by payout.accrued_at desc
        limit 40
      ) as recent_rows
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_payout_overview()
from public, anon;

grant execute on function public.admin_payout_overview()
to authenticated;

create or replace function public.admin_mark_seller_paid(p_seller_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_id uuid := (select auth.uid());
  paid_total numeric(12, 2);
  paid_count integer;
begin
  if admin_id is null or not exists (
    select 1
    from public.users as account
    where account.id = admin_id and account.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;

  if p_seller_id is null or not exists (
    select 1
    from public.users as account
    where account.id = p_seller_id and account.role = 'seller'
  ) then
    raise exception 'Choose a supplier to pay.';
  end if;

  with marked as (
    update public.seller_payouts
    set status = 'paid',
        paid_at = now(),
        paid_by = admin_id
    where seller_id = p_seller_id
      and status = 'available'
    returning net_payable
  )
  select coalesce(sum(net_payable), 0), count(*)
  into paid_total, paid_count
  from marked;

  if paid_count = 0 then
    raise exception 'This supplier has no available payout.';
  end if;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    p_seller_id,
    null,
    'payout_paid',
    'Payout sent',
    'SoukCart marked ৳' || to_char(paid_total, 'FM999999990.00') || ' as paid to your account.'
  );

  return jsonb_build_object(
    'sellerId', p_seller_id,
    'paidTotal', paid_total,
    'paidCount', paid_count
  );
end;
$$;

revoke execute on function public.admin_mark_seller_paid(uuid)
from public, anon;

grant execute on function public.admin_mark_seller_paid(uuid)
to authenticated;

create or replace function public.seller_earnings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := (select auth.uid());
  current_rate numeric(5, 4);
begin
  if v_seller_id is null or not exists (
    select 1
    from public.users as account
    where account.id = v_seller_id and account.role = 'seller'
  ) then
    raise exception 'A supplier account is required to view earnings.';
  end if;

  select commission_rate
  into current_rate
  from public.platform_settings
  where id = 'default';

  return jsonb_build_object(
    'commissionRate', coalesce(current_rate, 0),
    'available', (
      select coalesce(sum(payout.net_payable), 0)
      from public.seller_payouts as payout
      where payout.seller_id = v_seller_id and payout.status = 'available'
    ),
    'paid', (
      select coalesce(sum(payout.net_payable), 0)
      from public.seller_payouts as payout
      where payout.seller_id = v_seller_id and payout.status = 'paid'
    ),
    'commission', (
      select coalesce(sum(payout.commission_amount), 0)
      from public.seller_payouts as payout
      where payout.seller_id = v_seller_id and payout.status in ('available', 'paid')
    ),
    'rows', coalesce((
      select jsonb_agg(row_data order by accrued_at desc)
      from (
        select jsonb_build_object(
          'id', payout.id,
          'orderId', payout.order_id,
          'gross', payout.gross,
          'commissionRate', payout.commission_rate,
          'commissionAmount', payout.commission_amount,
          'netPayable', payout.net_payable,
          'status', payout.status,
          'accruedAt', payout.accrued_at,
          'paidAt', payout.paid_at
        ) as row_data,
        payout.accrued_at
        from public.seller_payouts as payout
        where payout.seller_id = v_seller_id
        order by payout.accrued_at desc
        limit 40
      ) as payout_rows
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.seller_earnings()
from public, anon;

grant execute on function public.seller_earnings()
to authenticated;

select public.accrue_seller_payouts_for_order(placed_order.id)
from public.orders as placed_order
where placed_order.status = 'delivered'
  and placed_order.payment_status = 'paid';
