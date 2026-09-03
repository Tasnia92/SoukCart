-- Prevent duplicate stock reservations from repeated checkout.
--
-- Online orders reserve stock at creation. Because the cart is intentionally
-- preserved until a payment succeeds (so a buyer can retry a failed payment),
-- a buyer who abandons the gateway and checks out again would create a second
-- pending order and reserve the same units twice.
--
-- To fix this without losing the cart, create_order_from_cart now fails any
-- earlier unpaid online order for the retailer before reserving the new one.
-- Failing an order releases its reserved stock through
-- handle_order_inventory_reservation, so only the latest checkout holds a
-- reservation. COD orders are never touched: they stay unpaid until cash is
-- collected at delivery.

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

  -- Supersede any earlier online checkout the retailer abandoned without
  -- paying. Failing those orders releases their reserved stock so repeated
  -- checkout attempts from the same cart cannot hold multiple reservations for
  -- the same units. COD orders are never touched: they stay unpaid until cash
  -- is collected at delivery.
  update public.orders
  set payment_status = 'failed'
  where retailer_id = p_retailer_id
    and payment_method = 'online'
    and payment_status = 'unpaid'
    and status <> 'cancelled'
    and stock_reserved = true;

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
