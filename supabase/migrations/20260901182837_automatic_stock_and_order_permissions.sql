-- Keep product values valid while still allowing checkout to sell the last unit.
-- Abort with a clear remediation message instead of partially migrating legacy
-- catalogs that still contain zero-priced rows.
do $$
begin
  if exists (select 1 from public.products where price <= 0) then
    raise exception 'Set every existing product price above zero before applying this migration.';
  end if;
end;
$$;

alter table public.products
  drop constraint if exists products_price_check;

alter table public.products
  add constraint products_price_positive check (price > 0);

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

  if tg_op = 'INSERT' and new.stock < 1 then
    raise exception 'A new product must have at least one unit in stock.';
  end if;

  if tg_op = 'UPDATE'
    and new.stock is distinct from old.stock
    and (select auth.uid()) is not null
    and (select auth.uid()) = old.seller_id
    and new.stock < 1
  then
    raise exception 'Supplier stock updates must be at least one unit.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_supplier_product_values()
from public, anon, authenticated;

drop trigger if exists products_validate_supplier_values on public.products;

create trigger products_validate_supplier_values
before insert or update on public.products
for each row
execute function public.enforce_supplier_product_values();

-- Track whether each order currently owns its inventory reservation. Existing
-- accepted orders were already deducted by the previous status trigger.
alter table public.orders
  add column if not exists stock_reserved boolean not null default false;

update public.orders
set stock_reserved = true
where status in ('confirmed', 'shipped', 'delivered');

drop trigger if exists orders_status_stock on public.orders;
drop function if exists public.handle_order_status_stock();
drop function if exists public.apply_order_stock_delta(uuid, integer);

create or replace function public.apply_order_inventory_delta(
  p_order_id uuid,
  p_delta integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  short_product text;
begin
  if p_delta not in (-1, 1) then
    raise exception 'Inventory delta must be -1 or 1.';
  end if;

  -- Lock every product in a stable order so concurrent checkouts cannot
  -- oversell and multi-product checkouts cannot deadlock one another.
  perform product.id
  from public.products as product
  join (
    select item.product_id, sum(item.quantity)::integer as quantity
    from public.order_items as item
    where item.order_id = p_order_id
    group by item.product_id
  ) as line on line.product_id = product.id
  order by product.id
  for update of product;

  if p_delta = -1 then
    select product.name
    into short_product
    from public.products as product
    join (
      select item.product_id, sum(item.quantity)::integer as quantity
      from public.order_items as item
      where item.order_id = p_order_id
      group by item.product_id
    ) as line on line.product_id = product.id
    where product.stock < line.quantity
    limit 1;

    if short_product is not null then
      raise exception 'Not enough stock for %.', short_product;
    end if;
  end if;

  update public.products as product
  set stock = product.stock + (p_delta * line.quantity)
  from (
    select item.product_id, sum(item.quantity)::integer as quantity
    from public.order_items as item
    where item.order_id = p_order_id
    group by item.product_id
  ) as line
  where line.product_id = product.id;
end;
$$;

revoke execute on function public.apply_order_inventory_delta(uuid, integer)
from public, anon, authenticated;

grant execute on function public.apply_order_inventory_delta(uuid, integer)
to service_role;

create or replace function public.create_order_from_cart(
  p_retailer_id uuid,
  p_notes text,
  p_payment_method text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_order_id uuid;
  invalid_product text;
  order_total numeric;
  cart_snapshot jsonb;
  result jsonb;
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

  -- Capture the cart once. Every later statement uses this immutable snapshot,
  -- so a concurrent browser cart edit cannot change the order mid-checkout.
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

  -- Lock every snapshotted product in a stable order before reading prices or
  -- availability. Concurrent checkouts then serialize without overselling.
  perform product.id
  from public.products as product
  join jsonb_to_recordset(cart_snapshot) as cart(product_id uuid, quantity integer)
    on cart.product_id = product.id
  order by product.id
  for update of product;

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
    stock_reserved
  )
  values (
    p_retailer_id,
    'pending',
    'unpaid',
    p_payment_method,
    nullif(btrim(p_notes), ''),
    true
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

revoke execute on function public.create_order_from_cart(uuid, text, text)
from public, anon, authenticated;

grant execute on function public.create_order_from_cart(uuid, text, text)
to service_role;

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

drop trigger if exists orders_inventory_reservation on public.orders;

create trigger orders_inventory_reservation
before update of status, payment_status on public.orders
for each row
execute function public.handle_order_inventory_reservation();

-- Checkout and order status changes now go through trusted Edge Functions.
revoke insert, update, delete on table public.orders from anon, authenticated;
revoke insert, update, delete on table public.order_items from anon, authenticated;

drop policy if exists orders_insert_own on public.orders;
drop policy if exists order_items_insert_own on public.order_items;
drop policy if exists order_items_update_own on public.order_items;

-- Supplier acceptance is separate from the admin-managed global order status.
create table if not exists public.order_supplier_acceptances (
  order_id uuid not null references public.orders(id) on delete cascade,
  supplier_id uuid not null references public.users(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  primary key (order_id, supplier_id)
);

alter table public.order_supplier_acceptances enable row level security;
revoke all on table public.order_supplier_acceptances from public, anon, authenticated;

create or replace function public.supplier_orders()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(json_agg(row_to_json(visible_order)), '[]'::json)
  from (
    select
      placed_order.id,
      placed_order.status,
      placed_order.cancel_requested,
      placed_order.payment_status,
      placed_order.payment_method,
      placed_order.notes,
      placed_order.created_at,
      retailer.name as retailer_name,
      retailer.email as retailer_email,
      acceptance.accepted_at,
      (
        select json_agg(json_build_object(
          'id', item.id,
          'product_id', item.product_id,
          'product_name', product.name,
          'quantity', item.quantity,
          'unit_price', item.unit_price,
          'line_total', item.quantity * item.unit_price
        ) order by product.name)
        from public.order_items as item
        join public.products as product on product.id = item.product_id
        where item.order_id = placed_order.id
          and product.seller_id = (select auth.uid())
      ) as items,
      (
        select coalesce(sum(item.quantity * item.unit_price), 0)
        from public.order_items as item
        join public.products as product on product.id = item.product_id
        where item.order_id = placed_order.id
          and product.seller_id = (select auth.uid())
      ) as supplier_total
    from public.orders as placed_order
    join public.users as retailer on retailer.id = placed_order.retailer_id
    left join public.order_supplier_acceptances as acceptance
      on acceptance.order_id = placed_order.id
      and acceptance.supplier_id = (select auth.uid())
    where exists (
      select 1
      from public.users as supplier
      where supplier.id = (select auth.uid()) and supplier.role = 'seller'
    )
      and exists (
        select 1
        from public.order_items as item
        join public.products as product on product.id = item.product_id
        where item.order_id = placed_order.id
          and product.seller_id = (select auth.uid())
      )
    order by placed_order.created_at desc
  ) as visible_order;
$$;

create or replace function public.seller_accept_order(p_order_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplier_id uuid := (select auth.uid());
  order_status text;
  cancellation_pending boolean;
  accepted timestamptz;
begin
  if supplier_id is null or not exists (
    select 1
    from public.users as account
    where account.id = supplier_id and account.role = 'seller'
  ) then
    raise exception 'A supplier account is required to accept orders.';
  end if;

  select placed_order.status, placed_order.cancel_requested
  into order_status, cancellation_pending
  from public.orders as placed_order
  where placed_order.id = p_order_id
  for update;

  if order_status is null
    or order_status <> 'pending'
    or cancellation_pending
    or not exists (
      select 1
      from public.order_items as item
      join public.products as product on product.id = item.product_id
      where item.order_id = p_order_id
        and product.seller_id = supplier_id
    )
  then
    raise exception 'This order is not available for acceptance.';
  end if;

  insert into public.order_supplier_acceptances (order_id, supplier_id)
  values (p_order_id, supplier_id)
  on conflict (order_id, supplier_id) do update
    set accepted_at = public.order_supplier_acceptances.accepted_at
  returning accepted_at into accepted;

  return accepted;
end;
$$;

revoke execute on function public.supplier_orders() from public, anon;
grant execute on function public.supplier_orders() to authenticated;

revoke execute on function public.seller_accept_order(uuid) from public, anon;
grant execute on function public.seller_accept_order(uuid) to authenticated;

revoke execute on function public.seller_set_order_status(uuid, text)
from public, anon, authenticated;

drop function if exists public.seller_set_order_status(uuid, text);

-- Retailers request cancellation; only the admin changes order status.
create or replace function public.request_order_cancellation(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to manage your orders.';
  end if;

  select placed_order.status
  into current_status
  from public.orders as placed_order
  where placed_order.id = p_order_id
    and placed_order.retailer_id = (select auth.uid());

  if current_status is null then
    raise exception 'Order not found.';
  end if;

  if current_status not in ('pending', 'confirmed') then
    raise exception 'This order can no longer be cancelled. Shipped orders cannot be cancelled and delivered orders follow the return policy.';
  end if;

  update public.orders
  set cancel_requested = true,
      cancel_requested_at = now()
  where id = p_order_id
    and retailer_id = (select auth.uid());

  return 'requested';
end;
$$;

revoke execute on function public.request_order_cancellation(uuid) from public, anon;
grant execute on function public.request_order_cancellation(uuid) to authenticated;

-- Publish product inserts and stock updates so open retailer and supplier views
-- can refresh without requiring a manual reload.
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'products'
  ) then
    alter publication supabase_realtime add table public.products;
  end if;
end;
$$;
