-- Supplier-owned confirmation. Each seller on an order has a package.
-- Admin cannot confirm; they ship/deliver a package after that supplier confirms.
-- A declined package drops those items and notifies the retailer.

alter table public.order_supplier_acceptances
  add column if not exists status text,
  add column if not exists declined_at timestamptz,
  add column if not exists decline_reason text;

update public.order_supplier_acceptances
set status = coalesce(status, 'pending')
where status is null;

alter table public.order_supplier_acceptances
  alter column status set default 'pending',
  alter column status set not null,
  alter column accepted_at drop not null,
  alter column accepted_at drop default;

alter table public.order_supplier_acceptances
  drop constraint if exists order_supplier_acceptances_status_allowed;

alter table public.order_supplier_acceptances
  add constraint order_supplier_acceptances_status_allowed
  check (status in ('pending', 'confirmed', 'declined', 'shipped', 'delivered'));

alter table public.order_supplier_acceptances
  drop constraint if exists order_supplier_acceptances_decline_reason_length;

alter table public.order_supplier_acceptances
  add constraint order_supplier_acceptances_decline_reason_length
  check (decline_reason is null or char_length(btrim(decline_reason)) between 1 and 500);

-- Existing open orders get a package per seller. Status follows the whole order
-- until suppliers start confirming independently.
insert into public.order_supplier_acceptances (order_id, supplier_id, status, accepted_at)
select distinct
  item.order_id,
  item.seller_id,
  case placed_order.status
    when 'cancelled' then 'declined'
    when 'delivered' then 'delivered'
    when 'shipped' then 'shipped'
    when 'confirmed' then 'confirmed'
    else 'pending'
  end,
  case
    when placed_order.status in ('confirmed', 'shipped', 'delivered') then coalesce(placed_order.created_at, now())
    else null
  end
from public.order_items as item
join public.orders as placed_order on placed_order.id = item.order_id
where item.seller_id is not null
on conflict (order_id, supplier_id) do update
  set status = case
    when public.order_supplier_acceptances.status is distinct from 'pending'
      then public.order_supplier_acceptances.status
    else excluded.status
  end,
  accepted_at = coalesce(public.order_supplier_acceptances.accepted_at, excluded.accepted_at);

grant select on table public.order_supplier_acceptances to authenticated;

drop policy if exists order_supplier_acceptances_read_as_supplier on public.order_supplier_acceptances;
create policy order_supplier_acceptances_read_as_supplier
  on public.order_supplier_acceptances
  for select
  to authenticated
  using (supplier_id = (select auth.uid()));

drop policy if exists order_supplier_acceptances_read_as_retailer on public.order_supplier_acceptances;
create policy order_supplier_acceptances_read_as_retailer
  on public.order_supplier_acceptances
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders as placed_order
      where placed_order.id = order_supplier_acceptances.order_id
        and placed_order.retailer_id = (select auth.uid())
    )
  );

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

  perform product.id
  from public.products as product
  join (
    select item.product_id, sum(item.quantity)::integer as quantity
    from public.order_items as item
    where item.order_id = p_order_id
      and not exists (
        select 1
        from public.order_supplier_acceptances as package
        where package.order_id = item.order_id
          and package.supplier_id is not distinct from item.seller_id
          and package.status = 'declined'
      )
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
        and not exists (
          select 1
          from public.order_supplier_acceptances as package
          where package.order_id = item.order_id
            and package.supplier_id is not distinct from item.seller_id
            and package.status = 'declined'
        )
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
      and not exists (
        select 1
        from public.order_supplier_acceptances as package
        where package.order_id = item.order_id
          and package.supplier_id is not distinct from item.seller_id
          and package.status = 'declined'
      )
    group by item.product_id
  ) as line
  where line.product_id = product.id;
end;
$$;

create or replace function private.apply_seller_inventory_delta(
  p_order_id uuid,
  p_seller_id uuid,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  short_product text;
begin
  if p_delta not in (-1, 1) then
    raise exception 'Inventory delta must be -1 or 1.';
  end if;

  perform product.id
  from public.products as product
  join (
    select item.product_id, sum(item.quantity)::integer as quantity
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id = p_seller_id
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
        and item.seller_id = p_seller_id
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
      and item.seller_id = p_seller_id
    group by item.product_id
  ) as line
  where line.product_id = product.id;
end;
$$;

revoke all on function private.apply_seller_inventory_delta(uuid, uuid, integer) from public;
grant execute on function private.apply_seller_inventory_delta(uuid, uuid, integer)
to service_role;

create or replace function private.sync_order_status_from_packages(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  placed_order public.orders%rowtype;
  next_status text;
  active_count integer := 0;
  confirmed_count integer := 0;
  shipped_count integer := 0;
  delivered_count integer := 0;
begin
  select *
  into placed_order
  from public.orders
  where id = p_order_id
  for update;

  if placed_order.id is null then
    raise exception 'Order not found.';
  end if;

  if placed_order.status = 'cancelled' then
    return 'cancelled';
  end if;

  select
    count(*) filter (where package.status <> 'declined'),
    count(*) filter (where package.status in ('confirmed', 'shipped', 'delivered')),
    count(*) filter (where package.status in ('shipped', 'delivered')),
    count(*) filter (where package.status = 'delivered')
  into active_count, confirmed_count, shipped_count, delivered_count
  from public.order_supplier_acceptances as package
  where package.order_id = p_order_id;

  if active_count = 0 then
    next_status := 'cancelled';
  elsif delivered_count = active_count then
    next_status := 'delivered';
  elsif shipped_count = active_count then
    next_status := 'shipped';
  elsif confirmed_count > 0 then
    next_status := 'confirmed';
  else
    next_status := 'pending';
  end if;

  update public.orders
  set status = next_status,
      delivered_at = case
        when next_status = 'delivered' then coalesce(delivered_at, now())
        else delivered_at
      end,
      cancelled_at = case
        when next_status = 'cancelled' then coalesce(cancelled_at, now())
        else cancelled_at
      end,
      cancellation_initiator = case
        when next_status = 'cancelled' then coalesce(cancellation_initiator, 'supplier')
        else cancellation_initiator
      end
  where id = p_order_id;

  return next_status;
end;
$$;

revoke all on function private.sync_order_status_from_packages(uuid) from public;
grant execute on function private.sync_order_status_from_packages(uuid)
to service_role;

create or replace function private.ensure_order_packages(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.order_supplier_acceptances (order_id, supplier_id, status, accepted_at)
  select distinct item.order_id, item.seller_id, 'pending', null
  from public.order_items as item
  where item.order_id = p_order_id
    and item.seller_id is not null
  on conflict (order_id, supplier_id) do nothing;
end;
$$;

revoke all on function private.ensure_order_packages(uuid) from public;
grant execute on function private.ensure_order_packages(uuid) to service_role;

create or replace function private.notify_suppliers_order_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fulfillable boolean;
  was_fulfillable boolean := false;
  short_ref text;
begin
  fulfillable :=
    new.status is distinct from 'cancelled'
    and new.delivery_payment_status is not distinct from 'paid'
    and (
      new.payment_method = 'cod'
      or new.payment_status is not distinct from 'paid'
    );

  if tg_op = 'UPDATE' then
    was_fulfillable :=
      old.status is distinct from 'cancelled'
      and old.delivery_payment_status is not distinct from 'paid'
      and (
        old.payment_method = 'cod'
        or old.payment_status is not distinct from 'paid'
      );
  end if;

  if not fulfillable or was_fulfillable then
    return new;
  end if;

  perform private.ensure_order_packages(new.id);
  short_ref := upper(substr(new.id::text, 1, 8));

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select distinct item.seller_id,
    new.id,
    'order_needs_confirmation',
    'Order waiting for confirmation',
    'Order #' || short_ref || ' is paid and waiting for you to confirm your items.'
  from public.order_items as item
  where item.order_id = new.id
    and item.seller_id is not null
    and not exists (
      select 1
      from public.notifications as existing
      where existing.recipient_id = item.seller_id
        and existing.order_id = new.id
        and existing.type = 'order_needs_confirmation'
    );

  return new;
end;
$$;

revoke all on function private.notify_suppliers_order_ready() from public;

drop trigger if exists orders_notify_suppliers_ready on public.orders;
create trigger orders_notify_suppliers_ready
after insert or update of status, payment_status, delivery_payment_status on public.orders
for each row
execute function private.notify_suppliers_order_ready();

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
  merchandise_total numeric;
  delivery_fee numeric := public.default_delivery_charge();
  payable_now numeric;
  cart_snapshot jsonb;
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
  set payment_status = 'failed',
      delivery_payment_status = case
        when delivery_payment_status = 'paid' then delivery_payment_status
        else 'failed'
      end
  where retailer_id = p_retailer_id
    and status <> 'cancelled'
    and stock_reserved = true
    and (
      (
        payment_method = 'online'
        and payment_status = 'unpaid'
      )
      or (
        payment_method = 'cod'
        and delivery_payment_status = 'unpaid'
        and payment_status = 'unpaid'
      )
    );

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

  if exists (
    select 1
    from jsonb_to_recordset(cart_snapshot) as cart(product_id uuid, quantity integer)
    join public.products as product on product.id = cart.product_id
    where product.seller_id is null
      or not private.is_approved_supplier(product.seller_id)
  ) then
    raise exception 'One or more suppliers are not available for orders.';
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
  into merchandise_total
  from jsonb_to_recordset(cart_snapshot) as cart(product_id uuid, quantity integer)
  join public.products as product on product.id = cart.product_id;

  if merchandise_total is null or merchandise_total < 10 then
    raise exception 'The order total must be at least 10.00 BDT.';
  end if;

  payable_now := case
    when p_payment_method = 'cod' then delivery_fee
    else round(merchandise_total + delivery_fee, 2)
  end;

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
    delivery_postcode,
    delivery_charge,
    delivery_payment_status
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
    delivery_postcode,
    delivery_fee,
    'unpaid'
  )
  returning id into new_order_id;

  insert into public.order_items (
    order_id,
    product_id,
    quantity,
    unit_price,
    seller_id,
    product_name,
    unit
  )
  select
    new_order_id,
    product.id,
    cart.quantity,
    product.price,
    product.seller_id,
    product.name,
    product.unit
  from jsonb_to_recordset(cart_snapshot) as cart(product_id uuid, quantity integer)
  join public.products as product on product.id = cart.product_id;

  perform public.apply_order_inventory_delta(new_order_id, -1);
  perform private.ensure_order_packages(new_order_id);

  select jsonb_build_object(
    'orderId', new_order_id,
    'total', merchandise_total,
    'merchandiseTotal', merchandise_total,
    'deliveryCharge', delivery_fee,
    'payableNow', payable_now,
    'paymentMethod', p_payment_method,
    'lines', jsonb_agg(
      jsonb_build_object(
        'product_id', item.product_id,
        'product_name', item.product_name,
        'quantity', item.quantity,
        'price', item.unit_price
      )
      order by item.product_name
    )
  )
  into result
  from public.order_items as item
  where item.order_id = new_order_id;

  return result;
end;
$$;

revoke execute on function public.create_order_from_cart(uuid, text, text, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.create_order_from_cart(uuid, text, text, text, text, text, text)
to service_role;

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
      placed_order.cancellation_initiator,
      placed_order.cancellation_reason,
      placed_order.payment_status,
      placed_order.payment_method,
      placed_order.delivery_charge,
      placed_order.delivery_payment_status,
      placed_order.delivery_paid_at,
      placed_order.delivery_verified_at,
      placed_order.delivery_phone,
      placed_order.delivery_address,
      placed_order.delivery_city,
      placed_order.delivery_postcode,
      placed_order.manual_refund_status,
      not exists (
        select 1
        from public.order_items as other_item
        where other_item.order_id = placed_order.id
          and other_item.seller_id is distinct from (select auth.uid())
      ) as supplier_can_cancel,
      placed_order.notes,
      placed_order.created_at,
      retailer.name as retailer_name,
      retailer.email as retailer_email,
      acceptance.accepted_at,
      coalesce(acceptance.status, 'pending') as package_status,
      acceptance.declined_at,
      acceptance.decline_reason,
      (
        select json_agg(json_build_object(
          'id', item.id,
          'product_id', item.product_id,
          'product_name', item.product_name,
          'unit', item.unit,
          'quantity', item.quantity,
          'unit_price', item.unit_price,
          'line_total', item.quantity * item.unit_price
        ) order by item.product_name)
        from public.order_items as item
        where item.order_id = placed_order.id
          and item.seller_id = (select auth.uid())
      ) as items,
      (
        select coalesce(sum(item.quantity * item.unit_price), 0)
        from public.order_items as item
        where item.order_id = placed_order.id
          and item.seller_id = (select auth.uid())
      ) as supplier_total
    from public.orders as placed_order
    join public.users as retailer on retailer.id = placed_order.retailer_id
    left join public.order_supplier_acceptances as acceptance
      on acceptance.order_id = placed_order.id
      and acceptance.supplier_id = (select auth.uid())
    where private.is_approved_supplier((select auth.uid()))
      and exists (
        select 1
        from public.users as supplier
        where supplier.id = (select auth.uid())
          and supplier.role = 'seller'
      )
      and exists (
        select 1
        from public.order_items as item
        where item.order_id = placed_order.id
          and item.seller_id = (select auth.uid())
      )
    order by placed_order.created_at desc
  ) as visible_order;
$$;

revoke execute on function public.supplier_orders() from public, anon;
grant execute on function public.supplier_orders() to authenticated;

create or replace function public.seller_set_order_status(p_order_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid := private.require_approved_seller();
  placed_order public.orders%rowtype;
  supplier_name text;
  short_ref text;
  pending_others integer := 0;
  package_status text;
begin
  if p_status is distinct from 'confirmed' then
    raise exception 'Suppliers can confirm orders. Admin updates delivery status.';
  end if;

  if not exists (
    select 1
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id = v_supplier_id
  ) then
    raise exception 'This order is not assigned to your supplier account.';
  end if;

  select *
  into placed_order
  from public.orders
  where id = p_order_id
  for update;

  if placed_order.id is null then
    raise exception 'Order not found.';
  end if;

  if placed_order.cancel_requested then
    raise exception 'This order has a cancellation request. Wait for the admin team.';
  end if;

  if placed_order.status = 'cancelled' then
    raise exception 'This order is cancelled.';
  end if;

  if placed_order.delivery_payment_status is distinct from 'paid' then
    raise exception 'Wait for the retailer to pay the delivery charge before fulfilling this order.';
  end if;

  if placed_order.payment_method is distinct from 'cod'
    and placed_order.payment_status is distinct from 'paid'
  then
    raise exception 'Wait for payment before confirming this order.';
  end if;

  perform private.ensure_order_packages(p_order_id);

  select package.status
  into package_status
  from public.order_supplier_acceptances as package
  where package.order_id = p_order_id
    and package.supplier_id = v_supplier_id
  for update;

  if package_status is distinct from 'pending' then
    raise exception 'These items are not waiting for confirmation.';
  end if;

  update public.order_supplier_acceptances
  set status = 'confirmed',
      accepted_at = coalesce(accepted_at, now()),
      declined_at = null,
      decline_reason = null
  where order_id = p_order_id
    and supplier_id = v_supplier_id;

  perform private.sync_order_status_from_packages(p_order_id);

  select count(*)
  into pending_others
  from public.order_supplier_acceptances as package
  where package.order_id = p_order_id
    and package.supplier_id is distinct from v_supplier_id
    and package.status = 'pending';

  select coalesce(nullif(btrim(account.name), ''), 'A supplier')
  into supplier_name
  from public.users as account
  where account.id = v_supplier_id;

  short_ref := upper(substr(p_order_id::text, 1, 8));

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    placed_order.retailer_id,
    p_order_id,
    'order_confirmed',
    'Items confirmed',
    supplier_name || ' confirmed their items on order #' || short_ref || '.'
      || case
        when pending_others > 0
          then ' Other items are still waiting for supplier confirmation.'
        else ' Admin will update delivery next.'
      end
  );

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select account.id,
    p_order_id,
    'order_confirmed',
    'Supplier confirmed items',
    supplier_name || ' confirmed their items on order #' || short_ref || '. Mark that package shipped when the parcel leaves.'
  from public.users as account
  where account.role = 'admin';

  return 'confirmed';
end;
$$;

revoke execute on function public.seller_set_order_status(uuid, text)
from public, anon;
grant execute on function public.seller_set_order_status(uuid, text)
to authenticated;

create or replace function public.seller_decline_order_items(
  p_order_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid := private.require_approved_seller();
  placed_order public.orders%rowtype;
  package_status text;
  reason text := coalesce(nullif(btrim(p_reason), ''), 'Supplier declined these items');
  declined_total numeric(12, 2) := 0;
  remaining_active integer := 0;
  prepaid_delivery numeric(12, 2) := 0;
  refund_due numeric(12, 2) := 0;
  refund_state text := 'not_required';
  supplier_name text;
  short_ref text;
  next_status text;
begin
  if char_length(reason) > 500 then
    raise exception 'Give a shorter reason (500 characters or fewer).';
  end if;

  if not exists (
    select 1
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id = v_supplier_id
  ) then
    raise exception 'This order is not assigned to your supplier account.';
  end if;

  select *
  into placed_order
  from public.orders
  where id = p_order_id
  for update;

  if placed_order.id is null then
    raise exception 'Order not found.';
  end if;

  if placed_order.status = 'cancelled' then
    raise exception 'This order is already cancelled.';
  end if;

  if placed_order.cancel_requested then
    raise exception 'This order has a cancellation request. Wait for the admin team.';
  end if;

  perform private.ensure_order_packages(p_order_id);

  select package.status
  into package_status
  from public.order_supplier_acceptances as package
  where package.order_id = p_order_id
    and package.supplier_id = v_supplier_id
  for update;

  if package_status is distinct from 'pending' then
    raise exception 'Only unconfirmed items can be declined.';
  end if;

  select round(coalesce(sum(item.quantity * item.unit_price), 0), 2)
  into declined_total
  from public.order_items as item
  where item.order_id = p_order_id
    and item.seller_id = v_supplier_id;

  update public.order_supplier_acceptances
  set status = 'declined',
      declined_at = now(),
      decline_reason = reason
  where order_id = p_order_id
    and supplier_id = v_supplier_id;

  if placed_order.stock_reserved then
    perform private.apply_seller_inventory_delta(p_order_id, v_supplier_id, 1);
  end if;

  select count(*)
  into remaining_active
  from public.order_supplier_acceptances as package
  where package.order_id = p_order_id
    and package.status <> 'declined';

  prepaid_delivery := coalesce(placed_order.delivery_charge, 0);
  short_ref := upper(substr(p_order_id::text, 1, 8));

  select coalesce(nullif(btrim(account.name), ''), 'A supplier')
  into supplier_name
  from public.users as account
  where account.id = v_supplier_id;

  if remaining_active = 0 then
    if placed_order.payment_method = 'online' and placed_order.payment_status = 'paid' then
      refund_due := round(public.order_merchandise_total(p_order_id) + prepaid_delivery, 2);
      refund_state := case when refund_due > 0 then 'pending' else 'not_required' end;
    elsif placed_order.payment_method = 'cod' and placed_order.delivery_payment_status = 'paid' then
      refund_due := 0;
      refund_state := 'not_required';
    end if;

    update public.orders
    set status = 'cancelled',
        cancel_requested = false,
        cancelled_at = now(),
        cancelled_by = v_supplier_id,
        cancellation_initiator = 'supplier',
        cancellation_reason = reason,
        refund_amount = refund_due,
        manual_refund_status = refund_state,
        refund_completed_at = null,
        refund_completed_by = null
    where id = p_order_id;

    next_status := 'cancelled';
  else
    if placed_order.payment_method = 'online' and placed_order.payment_status = 'paid' then
      refund_due := round(coalesce(placed_order.refund_amount, 0) + declined_total, 2);
      refund_state := case when refund_due > 0 then 'pending' else placed_order.manual_refund_status end;
      update public.orders
      set refund_amount = refund_due,
          manual_refund_status = refund_state,
          refund_completed_at = null,
          refund_completed_by = null
      where id = p_order_id;
    end if;
    next_status := private.sync_order_status_from_packages(p_order_id);
  end if;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    placed_order.retailer_id,
    p_order_id,
    'supplier_items_cancelled',
    case when remaining_active = 0 then 'Order cancelled' else 'Some items were cancelled' end,
    case
      when remaining_active = 0 and refund_state = 'pending'
        then supplier_name || ' could not fulfill order #' || short_ref || '. A manual refund of ' || to_char(refund_due, 'FM999999990.00') || ' BDT is pending.'
      when remaining_active = 0
        then supplier_name || ' could not fulfill order #' || short_ref || '. The order was cancelled.'
      when placed_order.payment_method = 'online' and placed_order.payment_status = 'paid'
        then supplier_name || ' cancelled their items on order #' || short_ref || '. A merchandise refund of ' || to_char(declined_total, 'FM999999990.00') || ' BDT is pending. Remaining items are unaffected.'
      else supplier_name || ' cancelled their items on order #' || short_ref || '. Remaining items are unaffected.'
    end
  );

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select account.id,
    p_order_id,
    'supplier_items_cancelled',
    case when remaining_active = 0 then 'Order cancelled by supplier' else 'Supplier declined items' end,
    supplier_name || ' declined their items on order #' || short_ref || '.'
  from public.users as account
  where account.role = 'admin';

  return jsonb_build_object(
    'id', p_order_id,
    'status', next_status,
    'packageStatus', 'declined',
    'refundAmount', refund_due,
    'manualRefundStatus', refund_state
  );
end;
$$;

revoke execute on function public.seller_decline_order_items(uuid, text)
from public, anon;
grant execute on function public.seller_decline_order_items(uuid, text)
to authenticated;

create or replace function public.seller_request_order_cancellation(
  p_order_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplier_id uuid := private.require_approved_seller();
  placed_order public.orders%rowtype;
  package_status text;
begin
  if not exists (
    select 1
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id = supplier_id
  ) then
    raise exception 'This order is not assigned to your supplier account.';
  end if;

  if exists (
    select 1
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id is distinct from supplier_id
  ) then
    select package.status
    into package_status
    from public.order_supplier_acceptances as package
    where package.order_id = p_order_id
      and package.supplier_id = supplier_id;

    if package_status is not distinct from 'pending' then
      return public.seller_decline_order_items(p_order_id, p_reason);
    end if;

    raise exception 'After confirming, contact the admin team to change your fulfillment on a multi-supplier order.';
  end if;

  select *
  into placed_order
  from public.orders
  where id = p_order_id
  for update;

  if placed_order.id is null then
    raise exception 'Order not found.';
  end if;

  if placed_order.status = 'cancelled' then
    raise exception 'This order is already cancelled.';
  end if;

  if placed_order.status = 'delivered'
    and placed_order.delivery_verified_at is not null
  then
    raise exception 'A verified delivery can no longer be cancelled by a supplier.';
  end if;

  if placed_order.cancel_requested then
    raise exception 'A cancellation request is already pending.';
  end if;

  update public.orders
  set cancel_requested = true,
      cancel_requested_at = now(),
      cancellation_initiator = 'supplier',
      cancellation_requested_by = supplier_id,
      cancellation_reason = coalesce(nullif(btrim(p_reason), ''), 'Supplier requested cancellation')
  where id = p_order_id;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select distinct recipient.id,
    p_order_id,
    'supplier_cancellation_requested',
    'Supplier cancellation requested',
    case
      when placed_order.payment_method = 'online' and placed_order.payment_status = 'paid'
        then 'A supplier requested cancellation of order #' || upper(substr(p_order_id::text, 1, 8)) || '. A paid online order requires a full manual refund.'
      when placed_order.payment_method = 'cod' and placed_order.delivery_payment_status = 'paid'
        then 'A supplier requested cancellation of order #' || upper(substr(p_order_id::text, 1, 8)) || '. The retailer may request a refund of the prepaid delivery charge.'
      else 'A supplier requested cancellation of order #' || upper(substr(p_order_id::text, 1, 8)) || '.'
    end
  from (
    select account.id
    from public.users as account
    where account.role = 'admin'
    union
    select placed_order.retailer_id
    union
    select item.seller_id
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id is not null
  ) as recipient
  where recipient.id <> supplier_id;

  return jsonb_build_object(
    'status', 'requested',
    'initiator', 'supplier',
    'refundPolicy', case
      when placed_order.payment_method = 'online' and placed_order.payment_status = 'paid'
        then 'manual_full'
      else 'not_required'
    end
  );
end;
$$;

revoke execute on function public.seller_request_order_cancellation(uuid, text)
from public, anon;
grant execute on function public.seller_request_order_cancellation(uuid, text)
to authenticated;

drop function if exists public.admin_update_order_status(uuid, text, uuid, numeric, numeric);

create function public.admin_update_order_status(
  p_order_id uuid,
  p_status text,
  p_admin_id uuid,
  p_platform_charge numeric default 0,
  p_delivery_charge numeric default 0,
  p_supplier_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  placed_order public.orders%rowtype;
  merchandise_total numeric(12, 2);
  prepaid_delivery numeric(12, 2);
  refund_due numeric(12, 2) := 0;
  refund_state text := 'not_required';
  resolved_initiator text;
  request_was_pending boolean;
  retention numeric(12, 2) := 0;
  short_ref text;
  target_supplier uuid;
  package_status text;
  supplier_name text;
  next_status text;
  active_packages integer := 0;
begin
  if not exists (
    select 1
    from public.users as account
    where account.id = p_admin_id
      and account.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;

  if p_status not in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled') then
    raise exception 'Choose a valid order status.';
  end if;

  if p_status = 'confirmed' then
    raise exception 'Wait for the supplier to confirm this order.';
  end if;

  if coalesce(p_platform_charge, 0) < 0 or coalesce(p_delivery_charge, 0) < 0 then
    raise exception 'Cancellation charges cannot be negative.';
  end if;

  select *
  into placed_order
  from public.orders
  where id = p_order_id
  for update;

  if placed_order.id is null then
    raise exception 'Order not found.';
  end if;

  request_was_pending := placed_order.cancel_requested;
  prepaid_delivery := coalesce(placed_order.delivery_charge, 0);
  short_ref := upper(substr(p_order_id::text, 1, 8));
  perform private.ensure_order_packages(p_order_id);

  if p_status = placed_order.status and request_was_pending then
    update public.orders
    set cancel_requested = false,
        cancel_requested_at = null,
        cancellation_initiator = null,
        cancellation_requested_by = null,
        cancellation_reason = null
    where id = p_order_id;

    insert into public.notifications (recipient_id, order_id, type, title, message)
    select distinct recipient.id,
      p_order_id,
      'order_cancellation_rejected',
      'Cancellation request rejected',
      'The admin team rejected the cancellation request for order #' || short_ref || '.'
    from (
      select placed_order.retailer_id as id
      union
      select item.seller_id
      from public.order_items as item
      where item.order_id = p_order_id
        and item.seller_id is not null
    ) as recipient;

    return jsonb_build_object(
      'id', p_order_id,
      'status', placed_order.status,
      'cancelRequested', false,
      'manualRefundStatus', placed_order.manual_refund_status,
      'refundAmount', placed_order.refund_amount,
      'deliveryCharge', prepaid_delivery
    );
  end if;

  if placed_order.status = 'cancelled' then
    raise exception 'A cancelled order cannot be changed.';
  end if;

  if p_status in ('shipped', 'delivered')
    and placed_order.delivery_payment_status is distinct from 'paid'
  then
    raise exception 'Delivery must be paid before this order can be fulfilled.';
  end if;

  if p_status = 'cancelled' then
    merchandise_total := public.order_merchandise_total(p_order_id);

    resolved_initiator := coalesce(
      placed_order.cancellation_initiator,
      case
        when placed_order.status = 'delivered' and placed_order.delivery_verified_at is not null
          then 'support'
        else 'admin'
      end
    );

    if resolved_initiator = 'support' and not exists (
      select 1
      from public.complaints as support_request
      where support_request.order_id = p_order_id
        and support_request.retailer_id = placed_order.retailer_id
        and support_request.category = 'cancellation_refund'
    ) then
      raise exception 'A verified delivery requires an order-linked support request before cancellation.';
    end if;

    if placed_order.payment_method = 'online'
      and placed_order.payment_status = 'paid'
    then
      if resolved_initiator = 'supplier' then
        refund_due := round(merchandise_total + prepaid_delivery, 2);
        retention := 0;
      else
        refund_due := round(merchandise_total, 2);
        retention := 0;
      end if;
      refund_state := case when refund_due > 0 then 'pending' else 'not_required' end;
    elsif placed_order.payment_method = 'cod'
      and placed_order.delivery_payment_status = 'paid'
      and resolved_initiator = 'supplier'
    then
      refund_due := 0;
      refund_state := 'not_required';
      retention := 0;
    else
      retention := 0;
    end if;

    update public.orders
    set status = 'cancelled',
        cancel_requested = false,
        cancel_requested_at = null,
        cancellation_initiator = resolved_initiator,
        cancellation_reason = coalesce(
          cancellation_reason,
          case
            when resolved_initiator = 'support' then 'Order-linked support cancellation'
            when resolved_initiator = 'admin' then 'Administrator cancelled order'
            else null
          end
        ),
        cancelled_at = now(),
        cancelled_by = p_admin_id,
        platform_charge = retention,
        refund_amount = refund_due,
        manual_refund_status = refund_state,
        refund_completed_at = null,
        refund_completed_by = null
    where id = p_order_id;

    insert into public.notifications (recipient_id, order_id, type, title, message)
    select distinct recipient.id,
      p_order_id,
      'order_cancelled',
      'Order cancelled',
      case
        when refund_state = 'pending' and resolved_initiator = 'supplier'
          then 'Order #' || short_ref || ' was cancelled. A manual refund of ' || to_char(refund_due, 'FM999999990.00') || ' BDT (merchandise + delivery) is pending.'
        when refund_state = 'pending'
          then 'Order #' || short_ref || ' was cancelled. A manual refund of ' || to_char(refund_due, 'FM999999990.00') || ' BDT for merchandise is pending. Prepaid delivery is not refunded.'
        when placed_order.payment_method = 'cod'
          and placed_order.delivery_payment_status = 'paid'
          and resolved_initiator = 'supplier'
          then 'Order #' || short_ref || ' was cancelled by the supplier. You can request a refund of the prepaid delivery charge.'
        when placed_order.payment_method = 'cod'
          and placed_order.delivery_payment_status = 'paid'
          then 'Order #' || short_ref || ' was cancelled. Prepaid delivery is not refunded.'
        else 'Order #' || short_ref || ' was cancelled. No advance-payment refund is required.'
      end
    from (
      select account.id
      from public.users as account
      where account.role = 'admin'
        and account.id <> p_admin_id
      union
      select placed_order.retailer_id
    ) as recipient;

    insert into public.notifications (recipient_id, order_id, type, title, message)
    select distinct item.seller_id,
      p_order_id,
      'order_cancelled',
      'Order cancelled',
      'Order #' || short_ref || ' was cancelled. The admin team is handling any retailer refund manually.'
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id is not null;

    update public.order_supplier_acceptances
    set status = 'declined',
        declined_at = coalesce(declined_at, now()),
        decline_reason = coalesce(decline_reason, 'Order cancelled')
    where order_id = p_order_id
      and status in ('pending', 'confirmed');
  elsif p_status in ('shipped', 'delivered') then
    select count(*)
    into active_packages
    from public.order_supplier_acceptances as package
    where package.order_id = p_order_id
      and package.status <> 'declined';

    target_supplier := p_supplier_id;
    if target_supplier is null then
      if active_packages <> 1 then
        raise exception 'Choose which supplier package to update.';
      end if;
      select package.supplier_id
      into target_supplier
      from public.order_supplier_acceptances as package
      where package.order_id = p_order_id
        and package.status <> 'declined';
    end if;

    select package.status
    into package_status
    from public.order_supplier_acceptances as package
    where package.order_id = p_order_id
      and package.supplier_id = target_supplier
    for update;

    if package_status is null or package_status = 'declined' then
      raise exception 'That supplier package is not available.';
    end if;

    if p_status = 'shipped' and package_status is distinct from 'confirmed' then
      raise exception 'Wait for the supplier to confirm before shipping these items.';
    end if;

    if p_status = 'delivered' and package_status is distinct from 'shipped' then
      raise exception 'Mark these items shipped before marking them delivered.';
    end if;

    update public.order_supplier_acceptances
    set status = p_status
    where order_id = p_order_id
      and supplier_id = target_supplier;

    update public.order_shipments
    set status = case
          when p_status = 'delivered' then 'delivered'
          else 'shipped'
        end,
        updated_at = now()
    where order_id = p_order_id
      and seller_id = target_supplier;

    next_status := private.sync_order_status_from_packages(p_order_id);

    select coalesce(nullif(btrim(account.name), ''), 'Supplier')
    into supplier_name
    from public.users as account
    where account.id = target_supplier;

    insert into public.notifications (recipient_id, order_id, type, title, message)
    values (
      placed_order.retailer_id,
      p_order_id,
      case when p_status = 'shipped' then 'order_shipped' else 'order_delivered' end,
      case when p_status = 'shipped' then 'Items shipped' else 'Items delivered' end,
      case
        when p_status = 'shipped'
          then 'Items from ' || supplier_name || ' on order #' || short_ref || ' are on the way.'
        else 'Items from ' || supplier_name || ' on order #' || short_ref || ' were marked delivered. Please confirm you received them.'
      end
    );

    insert into public.notifications (recipient_id, order_id, type, title, message)
    values (
      target_supplier,
      p_order_id,
      case when p_status = 'shipped' then 'order_shipped' else 'order_delivered' end,
      case when p_status = 'shipped' then 'Items shipped' else 'Items delivered' end,
      case
        when p_status = 'shipped'
          then 'Admin marked your items on order #' || short_ref || ' as shipped.'
        else 'Admin marked your items on order #' || short_ref || ' as delivered.'
      end
    );
  else
    raise exception 'Choose the next valid order status.';
  end if;

  return jsonb_build_object(
    'id', p_order_id,
    'status', coalesce(next_status, p_status),
    'cancelRequested', false,
    'cancellationInitiator', resolved_initiator,
    'manualRefundStatus', refund_state,
    'refundAmount', refund_due,
    'platformCharge', retention,
    'deliveryCharge', prepaid_delivery,
    'supplierId', target_supplier
  );
end;
$$;

revoke execute on function public.admin_update_order_status(uuid, text, uuid, numeric, numeric, uuid)
from public, anon, authenticated;
grant execute on function public.admin_update_order_status(uuid, text, uuid, numeric, numeric, uuid)
to service_role;
