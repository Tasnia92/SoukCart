-- Persist delivery details, one supplier per order, seller-driven
-- confirm/ship/deliver, block unpaid online fulfillment, and settle COD.

alter table public.orders
  add column if not exists delivery_phone text,
  add column if not exists delivery_address text,
  add column if not exists delivery_city text,
  add column if not exists delivery_postcode text;

-- Online orders cannot move into fulfillment until SSLCommerz has marked them paid.
-- COD may be confirmed and shipped while still unpaid; cash is recorded separately.
create or replace function public.guard_unpaid_online_fulfillment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status in ('confirmed', 'shipped', 'delivered')
    and new.payment_method = 'online'
    and new.payment_status is distinct from 'paid'
  then
    raise exception 'Online orders must be paid before they can be fulfilled.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_unpaid_online_fulfillment()
from public, anon, authenticated;

drop trigger if exists orders_guard_unpaid_online_fulfillment on public.orders;

create trigger orders_guard_unpaid_online_fulfillment
before insert or update of status, payment_method, payment_status on public.orders
for each row
execute function public.guard_unpaid_online_fulfillment();

drop function if exists public.create_order_from_cart(uuid, text, text);

create function public.create_order_from_cart(
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

create or replace function public.seller_set_order_status(p_order_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid := (select auth.uid());
  placed_order public.orders%rowtype;
begin
  if v_supplier_id is null or not exists (
    select 1
    from public.users as account
    where account.id = v_supplier_id and account.role = 'seller'
  ) then
    raise exception 'A supplier account is required to update orders.';
  end if;

  if p_status not in ('confirmed', 'shipped', 'delivered') then
    raise exception 'Choose a valid fulfillment status.';
  end if;

  if not exists (
    select 1
    from public.order_items as item
    join public.products as product on product.id = item.product_id
    where item.order_id = p_order_id
      and product.seller_id = v_supplier_id
  ) then
    raise exception 'This order is not assigned to your supplier account.';
  end if;

  if exists (
    select 1
    from public.order_items as item
    join public.products as product on product.id = item.product_id
    where item.order_id = p_order_id
      and product.seller_id is distinct from v_supplier_id
  ) then
    raise exception 'A supplier cannot fulfill a multi-supplier order. Contact the admin team.';
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

  if not (
    (placed_order.status = 'pending' and p_status = 'confirmed')
    or (placed_order.status = 'confirmed' and p_status = 'shipped')
    or (placed_order.status = 'shipped' and p_status = 'delivered')
  ) then
    raise exception 'Choose the next valid order status.';
  end if;

  update public.orders
  set status = p_status,
      delivered_at = case when p_status = 'delivered' then now() else delivered_at end
  where id = p_order_id;

  return p_status;
end;
$$;

revoke execute on function public.seller_set_order_status(uuid, text)
from public, anon;

grant execute on function public.seller_set_order_status(uuid, text)
to authenticated;

create or replace function public.collect_cod_payment(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  collected public.orders%rowtype;
begin
  if actor_id is null then
    raise exception 'Sign in to record a cash payment.';
  end if;

  select account.role
  into actor_role
  from public.users as account
  where account.id = actor_id;

  if actor_role is distinct from 'admin' and actor_role is distinct from 'seller' then
    raise exception 'Only a supplier or administrator can record cash collection.';
  end if;

  if actor_role = 'seller' and not exists (
    select 1
    from public.order_items as item
    join public.products as product on product.id = item.product_id
    where item.order_id = p_order_id
      and product.seller_id = actor_id
  ) then
    raise exception 'This order is not assigned to your supplier account.';
  end if;

  update public.orders
  set payment_status = 'paid',
      paid_at = coalesce(paid_at, now())
  where id = p_order_id
    and payment_method = 'cod'
    and payment_status = 'unpaid'
    and status <> 'cancelled'
  returning * into collected;

  if collected.id is null then
    raise exception 'This order is not waiting for cash collection.';
  end if;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    collected.retailer_id,
    collected.id,
    'cod_collected',
    'Cash on delivery collected',
    'Cash was collected for order #' || upper(substr(collected.id::text, 1, 8)) || '. Your invoice is ready.'
  );

  return jsonb_build_object(
    'id', collected.id,
    'paymentStatus', 'paid',
    'paidAt', collected.paid_at
  );
end;
$$;

revoke execute on function public.collect_cod_payment(uuid)
from public, anon;

grant execute on function public.collect_cod_payment(uuid)
to authenticated;

create or replace function public.expire_stale_unpaid_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_online integer := 0;
  expired_cod integer := 0;
begin
  with expired as (
    update public.orders
    set payment_status = 'failed'
    where payment_method = 'online'
      and payment_status = 'unpaid'
      and status <> 'cancelled'
      and stock_reserved = true
      and created_at < now() - interval '30 minutes'
    returning id
  )
  select count(*) into expired_online from expired;

  -- Abandoned COD that was never confirmed holds stock forever. Cancel it after a day.
  with expired as (
    update public.orders
    set status = 'cancelled',
        cancelled_at = now(),
        cancellation_initiator = 'admin',
        cancellation_reason = 'Unpaid COD expired before confirmation.'
    where payment_method = 'cod'
      and payment_status = 'unpaid'
      and status = 'pending'
      and created_at < now() - interval '24 hours'
    returning id
  )
  select count(*) into expired_cod from expired;

  return expired_online + expired_cod;
end;
$$;

revoke execute on function public.expire_stale_unpaid_orders()
from public, anon, authenticated;

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
      placed_order.delivery_verified_at,
      placed_order.delivery_phone,
      placed_order.delivery_address,
      placed_order.delivery_city,
      placed_order.delivery_postcode,
      placed_order.manual_refund_status,
      not exists (
        select 1
        from public.order_items as other_item
        join public.products as other_product on other_product.id = other_item.product_id
        where other_item.order_id = placed_order.id
          and other_product.seller_id is distinct from (select auth.uid())
      ) as supplier_can_cancel,
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
      where supplier.id = (select auth.uid())
        and supplier.role = 'seller'
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

revoke execute on function public.supplier_orders() from public, anon;
grant execute on function public.supplier_orders() to authenticated;
