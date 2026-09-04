-- Allow retailers to checkout carts that include products from multiple suppliers.
-- Seller fulfillment/cancel for multi-supplier orders remains admin-mediated.

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
