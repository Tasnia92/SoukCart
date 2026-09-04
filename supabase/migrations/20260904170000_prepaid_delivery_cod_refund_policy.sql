-- Prepaid delivery charge on every order.
-- COD still collects merchandise in cash, but delivery must be paid online first.
-- Supplier-cancelled online orders refund merchandise + delivery (manual).
-- Supplier-cancelled COD lets the retailer request a delivery-charge refund.

create or replace function public.default_delivery_charge()
returns numeric
language sql
immutable
set search_path = ''
as $$
  select 60.00::numeric(12, 2);
$$;

revoke execute on function public.default_delivery_charge() from public, anon;
grant execute on function public.default_delivery_charge() to authenticated, service_role;

alter table public.orders
  add column if not exists delivery_payment_status text not null default 'unpaid',
  add column if not exists delivery_paid_at timestamptz;

alter table public.orders
  drop constraint if exists orders_delivery_payment_status_check;

alter table public.orders
  add constraint orders_delivery_payment_status_check
    check (delivery_payment_status in ('unpaid', 'paid', 'failed', 'cancelled'));

-- Historical rows: online paid orders already covered delivery in the same capture.
update public.orders
set delivery_payment_status = 'paid',
    delivery_paid_at = coalesce(delivery_paid_at, paid_at, created_at)
where payment_method = 'online'
  and payment_status = 'paid'
  and delivery_payment_status is distinct from 'paid';

alter table public.orders
  drop constraint if exists orders_manual_refund_state_check;

alter table public.orders
  add constraint orders_manual_refund_state_check
  check (
    (
      manual_refund_status = 'not_required'
      and refund_amount = 0
      and refund_completed_at is null
      and refund_completed_by is null
    )
    or (
      manual_refund_status = 'review_required'
      and status = 'cancelled'
      and payment_method = 'online'
      and payment_status = 'paid'
      and refund_amount = 0
      and refund_completed_at is null
      and refund_completed_by is null
    )
    or (
      manual_refund_status = 'pending'
      and status = 'cancelled'
      and refund_amount > 0
      and refund_completed_at is null
      and refund_completed_by is null
      and (
        (payment_method = 'online' and payment_status = 'paid')
        or (payment_method = 'cod' and delivery_payment_status = 'paid')
      )
    )
    or (
      manual_refund_status = 'completed'
      and status = 'cancelled'
      and refund_amount > 0
      and refund_completed_at is not null
      and refund_completed_by is not null
      and (
        (payment_method = 'online' and payment_status = 'paid')
        or (payment_method = 'cod' and delivery_payment_status = 'paid')
      )
    )
  );

create or replace function public.order_merchandise_total(p_order_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select round(coalesce(sum(item.quantity * item.unit_price), 0), 2)
  from public.order_items as item
  where item.order_id = p_order_id;
$$;

revoke execute on function public.order_merchandise_total(uuid) from public, anon;
grant execute on function public.order_merchandise_total(uuid) to authenticated, service_role;

create or replace function public.order_gateway_amount(p_order_id uuid)
returns numeric
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  placed_order public.orders%rowtype;
  merchandise numeric(12, 2);
begin
  select *
  into placed_order
  from public.orders
  where id = p_order_id;

  if placed_order.id is null then
    return 0;
  end if;

  merchandise := public.order_merchandise_total(p_order_id);

  if placed_order.payment_method = 'cod' then
    return round(coalesce(placed_order.delivery_charge, 0), 2);
  end if;

  return round(merchandise + coalesce(placed_order.delivery_charge, 0), 2);
end;
$$;

revoke execute on function public.order_gateway_amount(uuid) from public, anon;
grant execute on function public.order_gateway_amount(uuid) to authenticated, service_role;

-- Capture SSLCommerz success: online pays goods+delivery; COD pays delivery only.
create or replace function public.capture_gateway_payment(
  p_order_id uuid,
  p_amount numeric,
  p_val_id text default null,
  p_bank_tran_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  placed_order public.orders%rowtype;
  expected numeric(12, 2);
  now_ts timestamptz := now();
begin
  select *
  into placed_order
  from public.orders
  where id = p_order_id
  for update;

  if placed_order.id is null then
    raise exception 'Order not found.';
  end if;

  expected := public.order_gateway_amount(p_order_id);
  if round(coalesce(p_amount, -1), 2) is distinct from expected then
    raise exception 'Payment amount does not match the order total.';
  end if;

  if placed_order.payment_method = 'online' then
    if placed_order.payment_status = 'paid'
      and placed_order.delivery_payment_status = 'paid'
    then
      return jsonb_build_object(
        'orderId', placed_order.id,
        'paymentStatus', 'paid',
        'deliveryPaymentStatus', 'paid',
        'alreadyCaptured', true
      );
    end if;

    if placed_order.payment_status is distinct from 'unpaid' then
      raise exception 'This checkout is no longer valid. If money was taken, contact support for a refund.';
    end if;

    update public.orders
    set payment_status = 'paid',
        delivery_payment_status = 'paid',
        paid_at = coalesce(paid_at, now_ts),
        delivery_paid_at = coalesce(delivery_paid_at, now_ts),
        val_id = coalesce(nullif(btrim(coalesce(p_val_id, '')), ''), val_id),
        bank_tran_id = coalesce(nullif(btrim(coalesce(p_bank_tran_id, '')), ''), bank_tran_id)
    where id = p_order_id;

    return jsonb_build_object(
      'orderId', p_order_id,
      'paymentStatus', 'paid',
      'deliveryPaymentStatus', 'paid',
      'alreadyCaptured', false
    );
  end if;

  -- COD: only delivery is prepaid online.
  if placed_order.delivery_payment_status = 'paid' then
    return jsonb_build_object(
      'orderId', placed_order.id,
      'paymentStatus', placed_order.payment_status,
      'deliveryPaymentStatus', 'paid',
      'alreadyCaptured', true
    );
  end if;

  if placed_order.delivery_payment_status is distinct from 'unpaid'
    or placed_order.payment_status in ('failed', 'cancelled')
    or placed_order.status = 'cancelled'
  then
    raise exception 'This checkout is no longer valid. If money was taken, contact support for a refund.';
  end if;

  update public.orders
  set delivery_payment_status = 'paid',
      delivery_paid_at = coalesce(delivery_paid_at, now_ts),
      val_id = coalesce(nullif(btrim(coalesce(p_val_id, '')), ''), val_id),
      bank_tran_id = coalesce(nullif(btrim(coalesce(p_bank_tran_id, '')), ''), bank_tran_id)
  where id = p_order_id;

  return jsonb_build_object(
    'orderId', p_order_id,
    'paymentStatus', placed_order.payment_status,
    'deliveryPaymentStatus', 'paid',
    'alreadyCaptured', false
  );
end;
$$;

revoke execute on function public.capture_gateway_payment(uuid, numeric, text, text)
from public, anon, authenticated;
grant execute on function public.capture_gateway_payment(uuid, numeric, text, text)
to service_role;

create or replace function public.fail_gateway_payment(
  p_order_id uuid,
  p_status text default 'failed',
  p_val_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  placed_order public.orders%rowtype;
  next_status text := case when p_status = 'cancelled' then 'cancelled' else 'failed' end;
begin
  select *
  into placed_order
  from public.orders
  where id = p_order_id
  for update;

  if placed_order.id is null then
    raise exception 'Order not found.';
  end if;

  if placed_order.payment_method = 'online' then
    if placed_order.payment_status = 'paid' then
      return jsonb_build_object(
        'orderId', placed_order.id,
        'paymentStatus', 'paid',
        'deliveryPaymentStatus', placed_order.delivery_payment_status
      );
    end if;
    if placed_order.payment_status is distinct from 'unpaid' then
      return jsonb_build_object(
        'orderId', placed_order.id,
        'paymentStatus', placed_order.payment_status,
        'deliveryPaymentStatus', placed_order.delivery_payment_status
      );
    end if;

    update public.orders
    set payment_status = next_status,
        delivery_payment_status = next_status,
        val_id = coalesce(nullif(btrim(coalesce(p_val_id, '')), ''), val_id)
    where id = p_order_id;

    return jsonb_build_object(
      'orderId', p_order_id,
      'paymentStatus', next_status,
      'deliveryPaymentStatus', next_status
    );
  end if;

  if placed_order.delivery_payment_status = 'paid' then
    return jsonb_build_object(
      'orderId', placed_order.id,
      'paymentStatus', placed_order.payment_status,
      'deliveryPaymentStatus', 'paid'
    );
  end if;

  if placed_order.delivery_payment_status is distinct from 'unpaid' then
    return jsonb_build_object(
      'orderId', placed_order.id,
      'paymentStatus', placed_order.payment_status,
      'deliveryPaymentStatus', placed_order.delivery_payment_status
    );
  end if;

  update public.orders
  set payment_status = next_status,
      delivery_payment_status = next_status,
      val_id = coalesce(nullif(btrim(coalesce(p_val_id, '')), ''), val_id)
  where id = p_order_id;

  return jsonb_build_object(
    'orderId', p_order_id,
    'paymentStatus', next_status,
    'deliveryPaymentStatus', next_status
  );
end;
$$;

revoke execute on function public.fail_gateway_payment(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.fail_gateway_payment(uuid, text, text)
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

  if new.payment_status = 'paid'
    and old.payment_status is distinct from 'unpaid'
    and old.payment_status is distinct from 'paid'
  then
    raise exception 'This checkout is no longer valid. A leftover or expired payment cannot be captured.';
  end if;

  should_reserve := new.status <> 'cancelled'
    and new.payment_status not in ('failed', 'cancelled')
    and new.delivery_payment_status not in ('failed', 'cancelled');

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

  -- Supersede abandoned gateway checkouts (online full pay or COD delivery pay).
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
      or not private.is_approved_supplier(product.seller_id)
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

create or replace function public.expire_stale_unpaid_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_gateway integer := 0;
  expired_cod integer := 0;
begin
  -- Abandoned SSLCommerz sessions: online full pay or COD delivery prepaid.
  with expired as (
    update public.orders
    set payment_status = 'failed',
        delivery_payment_status = case
          when delivery_payment_status = 'paid' then delivery_payment_status
          else 'failed'
        end
    where status <> 'cancelled'
      and stock_reserved = true
      and created_at < now() - interval '30 minutes'
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
      )
    returning id
  )
  select count(*) into expired_gateway from expired;

  -- COD with prepaid delivery that was never confirmed still holds stock.
  with expired as (
    update public.orders
    set status = 'cancelled',
        cancelled_at = now(),
        cancellation_initiator = 'admin',
        cancellation_reason = 'COD order expired before confirmation.',
        manual_refund_status = case
          when delivery_payment_status = 'paid' and delivery_charge > 0 then 'pending'
          else manual_refund_status
        end,
        refund_amount = case
          when delivery_payment_status = 'paid' and delivery_charge > 0 then delivery_charge
          else refund_amount
        end
    where payment_method = 'cod'
      and delivery_payment_status = 'paid'
      and payment_status = 'unpaid'
      and status = 'pending'
      and created_at < now() - interval '24 hours'
    returning id
  )
  select count(*) into expired_cod from expired;

  return expired_gateway + expired_cod;
end;
$$;

create or replace function public.seller_set_order_status(p_order_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid := private.require_approved_seller();
  placed_order public.orders%rowtype;
begin
  if p_status = 'shipped' then
    raise exception 'Use ship with carrier and tracking number to mark an order shipped.';
  end if;

  if p_status not in ('confirmed', 'delivered') then
    raise exception 'Choose a valid fulfillment status.';
  end if;

  if not exists (
    select 1
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id = v_supplier_id
  ) then
    raise exception 'This order is not assigned to your supplier account.';
  end if;

  if exists (
    select 1
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id is distinct from v_supplier_id
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
    or (placed_order.status = 'shipped' and p_status = 'delivered')
  ) then
    raise exception 'Choose the next valid order status.';
  end if;

  if placed_order.delivery_payment_status is distinct from 'paid' then
    raise exception 'Wait for the retailer to pay the delivery charge before fulfilling this order.';
  end if;

  if p_status = 'confirmed'
    and placed_order.payment_method is distinct from 'cod'
    and placed_order.payment_status is distinct from 'paid'
  then
    raise exception 'Wait for payment before confirming this order.';
  end if;

  if p_status = 'delivered'
    and placed_order.payment_method is distinct from 'cod'
    and placed_order.payment_status is distinct from 'paid'
  then
    raise exception 'Wait for payment before marking this order delivered.';
  end if;

  update public.orders
  set status = p_status,
      delivered_at = case when p_status = 'delivered' then now() else delivered_at end
  where id = p_order_id;

  if p_status = 'delivered' then
    update public.order_shipments
    set status = 'delivered',
        updated_at = now()
    where order_id = p_order_id
      and seller_id = v_supplier_id
      and status is distinct from 'delivered';

    insert into public.shipment_events (shipment_id, event_type, message, created_by)
    select shipment.id, 'delivered', 'Marked delivered by supplier', v_supplier_id
    from public.order_shipments as shipment
    where shipment.order_id = p_order_id
      and shipment.seller_id = v_supplier_id;
  end if;

  return p_status;
end;
$$;

revoke execute on function public.seller_set_order_status(uuid, text)
from public, anon;
grant execute on function public.seller_set_order_status(uuid, text)
to authenticated;

create or replace function public.seller_ship_order(
  p_order_id uuid,
  p_carrier text,
  p_tracking_number text,
  p_tracking_url text default '',
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid := private.require_approved_seller();
  placed_order public.orders%rowtype;
  v_carrier text := btrim(coalesce(p_carrier, ''));
  v_tracking_number text := btrim(coalesce(p_tracking_number, ''));
  v_tracking_url text := btrim(coalesce(p_tracking_url, ''));
  v_notes text := btrim(coalesce(p_notes, ''));
  v_shipment public.order_shipments%rowtype;
begin
  if char_length(v_carrier) < 2 or char_length(v_carrier) > 80 then
    raise exception 'Enter a carrier name (2–80 characters).';
  end if;

  if char_length(v_tracking_number) < 3 or char_length(v_tracking_number) > 80 then
    raise exception 'Enter a tracking number (3–80 characters).';
  end if;

  if char_length(v_tracking_url) > 500 then
    raise exception 'Tracking URL must be 500 characters or fewer.';
  end if;

  if v_tracking_url <> '' and v_tracking_url !~* '^https?://' then
    raise exception 'Tracking URL must start with http:// or https://.';
  end if;

  if char_length(v_notes) > 1000 then
    raise exception 'Shipment notes must be 1000 characters or fewer.';
  end if;

  if not exists (
    select 1
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id = v_supplier_id
  ) then
    raise exception 'This order is not assigned to your supplier account.';
  end if;

  if exists (
    select 1
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id is distinct from v_supplier_id
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

  if placed_order.status is distinct from 'confirmed' then
    raise exception 'Only confirmed orders can be marked shipped.';
  end if;

  if placed_order.delivery_payment_status is distinct from 'paid' then
    raise exception 'Wait for the retailer to pay the delivery charge before shipping this order.';
  end if;

  if placed_order.payment_method is distinct from 'cod'
    and placed_order.payment_status is distinct from 'paid'
  then
    raise exception 'Wait for payment before shipping this order.';
  end if;

  if exists (
    select 1
    from public.order_shipments as shipment
    where shipment.order_id = p_order_id
      and shipment.seller_id = v_supplier_id
  ) then
    raise exception 'A shipment already exists for this order.';
  end if;

  update public.orders
  set status = 'shipped'
  where id = p_order_id;

  insert into public.order_shipments (
    order_id,
    seller_id,
    carrier,
    tracking_number,
    tracking_url,
    status,
    notes
  )
  values (
    p_order_id,
    v_supplier_id,
    v_carrier,
    v_tracking_number,
    v_tracking_url,
    'shipped',
    v_notes
  )
  returning * into v_shipment;

  insert into public.shipment_events (
    shipment_id,
    event_type,
    message,
    created_by
  )
  values (
    v_shipment.id,
    'created',
    format('Shipped via %s · tracking %s', v_carrier, v_tracking_number),
    v_supplier_id
  );

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    placed_order.retailer_id,
    p_order_id,
    'order_shipped',
    'Your order was shipped',
    format(
      'Order shipped via %s. Tracking number: %s.',
      v_carrier,
      v_tracking_number
    )
  );

  return jsonb_build_object(
    'id', v_shipment.id,
    'orderId', p_order_id,
    'status', 'shipped',
    'carrier', v_carrier,
    'trackingNumber', v_tracking_number,
    'trackingUrl', v_tracking_url,
    'shippedAt', v_shipment.shipped_at
  );
end;
$$;

revoke execute on function public.seller_ship_order(uuid, text, text, text, text)
from public, anon;
grant execute on function public.seller_ship_order(uuid, text, text, text, text)
to authenticated;

create or replace function public.request_order_cancellation(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_id uuid := (select auth.uid());
  placed_order public.orders%rowtype;
begin
  if requester_id is null or not exists (
    select 1
    from public.users as account
    where account.id = requester_id
      and account.role = 'retailer'
  ) then
    raise exception 'A retailer account is required to cancel an order.';
  end if;

  select *
  into placed_order
  from public.orders
  where id = p_order_id
    and retailer_id = requester_id
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
    raise exception 'Verified deliveries cannot be cancelled here. Contact support for cancellation and refund assistance.';
  end if;

  if placed_order.cancel_requested then
    raise exception 'A cancellation request is already pending.';
  end if;

  update public.orders
  set cancel_requested = true,
      cancel_requested_at = now(),
      cancellation_initiator = 'retailer',
      cancellation_requested_by = requester_id,
      cancellation_reason = 'Retailer requested cancellation'
  where id = p_order_id;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select distinct recipient.id,
    p_order_id,
    'order_cancellation_requested',
    'Order cancellation requested',
    'Retailer requested cancellation of order #' || upper(substr(p_order_id::text, 1, 8)) || '.'
  from (
    select account.id
    from public.users as account
    where account.role = 'admin'
    union
    select item.seller_id
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id is not null
  ) as recipient;

  return jsonb_build_object(
    'status', 'requested',
    'initiator', 'retailer',
    'refundPolicy', case
      when placed_order.payment_method = 'online' and placed_order.payment_status = 'paid'
        then 'manual_less_charges'
      when placed_order.payment_method = 'cod'
        and placed_order.delivery_payment_status = 'paid'
        then 'delivery_refund_requestable'
      else 'not_required'
    end
  );
end;
$$;

revoke execute on function public.request_order_cancellation(uuid)
from public, anon;
grant execute on function public.request_order_cancellation(uuid)
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
    raise exception 'A supplier cannot cancel a multi-supplier order. Contact the admin team to resolve only your fulfillment.';
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
      when placed_order.payment_method = 'cod'
        and placed_order.delivery_payment_status = 'paid'
        then 'delivery_refund_requestable'
      else 'not_required'
    end
  );
end;
$$;

revoke execute on function public.seller_request_order_cancellation(uuid, text)
from public, anon;
grant execute on function public.seller_request_order_cancellation(uuid, text)
to authenticated;

create or replace function public.admin_update_order_status(
  p_order_id uuid,
  p_status text,
  p_admin_id uuid,
  p_platform_charge numeric default 0,
  p_delivery_charge numeric default 0
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
  retention numeric(12, 2) := greatest(coalesce(p_platform_charge, 0), 0);
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

  if retention < 0 or coalesce(p_delivery_charge, 0) < 0 then
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
      'The admin team rejected the cancellation request for order #' || upper(substr(p_order_id::text, 1, 8)) || '.'
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

  if p_status <> 'cancelled' and not (
    (placed_order.status = 'pending' and p_status = 'confirmed')
    or (placed_order.status = 'confirmed' and p_status = 'shipped')
    or (placed_order.status = 'shipped' and p_status = 'delivered')
  ) then
    raise exception 'Choose the next valid order status.';
  end if;

  if p_status in ('confirmed', 'shipped', 'delivered')
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
        if retention > merchandise_total + prepaid_delivery then
          raise exception 'Cancellation charges cannot exceed the paid order total.';
        end if;
        refund_due := round(merchandise_total + prepaid_delivery - retention, 2);
      end if;
      refund_state := case when refund_due > 0 then 'pending' else 'not_required' end;
    elsif placed_order.payment_method = 'cod'
      and placed_order.delivery_payment_status = 'paid'
      and resolved_initiator = 'supplier'
    then
      -- Retailer must explicitly request the delivery refund after supplier cancel.
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
        when refund_state = 'pending'
          then 'Order #' || upper(substr(p_order_id::text, 1, 8)) || ' was cancelled. A manual refund of ' || to_char(refund_due, 'FM999999990.00') || ' BDT is pending.'
        when placed_order.payment_method = 'cod'
          and placed_order.delivery_payment_status = 'paid'
          and resolved_initiator = 'supplier'
          then 'Order #' || upper(substr(p_order_id::text, 1, 8)) || ' was cancelled by the supplier. You can request a refund of the prepaid delivery charge.'
        else 'Order #' || upper(substr(p_order_id::text, 1, 8)) || ' was cancelled. No advance-payment refund is required.'
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
      'Order #' || upper(substr(p_order_id::text, 1, 8)) || ' was cancelled. The admin team is handling any retailer refund manually.'
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id is not null;
  else
    update public.orders
    set status = p_status,
        delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
        cancel_requested = false,
        cancel_requested_at = null,
        cancellation_initiator = null,
        cancellation_requested_by = null,
        cancellation_reason = null
    where id = p_order_id;
  end if;

  return jsonb_build_object(
    'id', p_order_id,
    'status', p_status,
    'cancelRequested', false,
    'cancellationInitiator', resolved_initiator,
    'manualRefundStatus', refund_state,
    'refundAmount', refund_due,
    'platformCharge', retention,
    'deliveryCharge', prepaid_delivery
  );
end;
$$;

revoke execute on function public.admin_update_order_status(uuid, text, uuid, numeric, numeric)
from public, anon, authenticated;
grant execute on function public.admin_update_order_status(uuid, text, uuid, numeric, numeric)
to service_role;

create or replace function public.request_cod_delivery_refund(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_id uuid := (select auth.uid());
  placed_order public.orders%rowtype;
begin
  if requester_id is null or not exists (
    select 1
    from public.users as account
    where account.id = requester_id
      and account.role = 'retailer'
  ) then
    raise exception 'A retailer account is required to request a delivery refund.';
  end if;

  select *
  into placed_order
  from public.orders
  where id = p_order_id
    and retailer_id = requester_id
  for update;

  if placed_order.id is null then
    raise exception 'Order not found.';
  end if;

  if placed_order.status is distinct from 'cancelled' then
    raise exception 'Only cancelled orders can request a delivery refund.';
  end if;

  if placed_order.payment_method is distinct from 'cod' then
    raise exception 'Delivery refund requests are only for cash on delivery orders.';
  end if;

  if placed_order.delivery_payment_status is distinct from 'paid' then
    raise exception 'No prepaid delivery charge was collected for this order.';
  end if;

  if placed_order.cancellation_initiator is distinct from 'supplier' then
    raise exception 'Delivery refunds can be requested when the supplier cancelled the order.';
  end if;

  if placed_order.manual_refund_status = 'pending' then
    raise exception 'A delivery refund is already pending.';
  end if;

  if placed_order.manual_refund_status = 'completed' then
    raise exception 'This delivery refund was already completed.';
  end if;

  if coalesce(placed_order.delivery_charge, 0) <= 0 then
    raise exception 'This order has no delivery charge to refund.';
  end if;

  update public.orders
  set refund_amount = delivery_charge,
      manual_refund_status = 'pending',
      refund_completed_at = null,
      refund_completed_by = null
  where id = p_order_id;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select account.id,
    p_order_id,
    'delivery_refund_requested',
    'Delivery refund requested',
    'Retailer requested a refund of the prepaid delivery charge for cancelled order #' || upper(substr(p_order_id::text, 1, 8)) || '.'
  from public.users as account
  where account.role = 'admin';

  return jsonb_build_object(
    'id', p_order_id,
    'manualRefundStatus', 'pending',
    'refundAmount', placed_order.delivery_charge
  );
end;
$$;

revoke execute on function public.request_cod_delivery_refund(uuid)
from public, anon;
grant execute on function public.request_cod_delivery_refund(uuid)
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

  if actor_role is distinct from 'admin' then
    raise exception 'Only SoukCart can record cash on delivery collection.';
  end if;

  update public.orders
  set payment_status = 'paid',
      paid_at = coalesce(paid_at, now())
  where id = p_order_id
    and payment_method = 'cod'
    and payment_status = 'unpaid'
    and delivery_payment_status = 'paid'
    and status not in ('pending', 'cancelled')
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

revoke execute on function public.collect_cod_payment(uuid) from public, anon;
grant execute on function public.collect_cod_payment(uuid) to authenticated;

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
      ) as supplier_total,
      (
        select json_build_object(
          'id', shipment.id,
          'carrier', shipment.carrier,
          'tracking_number', shipment.tracking_number,
          'tracking_url', shipment.tracking_url,
          'status', shipment.status,
          'notes', shipment.notes,
          'shipped_at', shipment.shipped_at,
          'updated_at', shipment.updated_at,
          'events', (
            select coalesce(json_agg(json_build_object(
              'id', event.id,
              'event_type', event.event_type,
              'message', event.message,
              'occurred_at', event.occurred_at
            ) order by event.occurred_at desc, event.created_at desc), '[]'::json)
            from public.shipment_events as event
            where event.shipment_id = shipment.id
          )
        )
        from public.order_shipments as shipment
        where shipment.order_id = placed_order.id
          and shipment.seller_id = (select auth.uid())
      ) as shipment
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

revoke execute on function public.expire_stale_unpaid_orders() from public, anon;
grant execute on function public.expire_stale_unpaid_orders() to service_role;
