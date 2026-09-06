-- Stock must not move at checkout or payment. The supplier confirm is the
-- inventory event. Cancel/fail returns stock only for packages that were
-- already confirmed (those units were actually taken).

create or replace function public.apply_order_inventory_delta(
  p_order_id uuid,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_rows integer := 0;
  reserved_lines integer := 0;
begin
  -- Whole-order delta is restore-only. Deduct happens per supplier on confirm.
  if p_delta is distinct from 1 then
    raise exception 'Order-level stock changes only return confirmed inventory.';
  end if;

  perform product.id
  from public.products as product
  join (
    select item.product_id, sum(item.quantity)::integer as quantity
    from public.order_items as item
    where item.order_id = p_order_id
      and exists (
        select 1
        from public.order_supplier_acceptances as package
        where package.order_id = item.order_id
          and package.supplier_id is not distinct from item.seller_id
          and package.status in ('confirmed', 'shipped', 'delivered')
      )
    group by item.product_id
  ) as line on line.product_id = product.id
  order by product.id
  for update of product;

  update public.products as product
  set
    stock = product.stock + line.quantity,
    stock_version = product.stock_version + 1
  from (
    select item.product_id, sum(item.quantity)::integer as quantity
    from public.order_items as item
    where item.order_id = p_order_id
      and exists (
        select 1
        from public.order_supplier_acceptances as package
        where package.order_id = item.order_id
          and package.supplier_id is not distinct from item.seller_id
          and package.status in ('confirmed', 'shipped', 'delivered')
      )
    group by item.product_id
  ) as line
  where line.product_id = product.id;

  get diagnostics updated_rows = row_count;

  select count(*)
  into reserved_lines
  from public.order_items as item
  where item.order_id = p_order_id
    and exists (
      select 1
      from public.order_supplier_acceptances as package
      where package.order_id = item.order_id
        and package.supplier_id is not distinct from item.seller_id
        and package.status in ('confirmed', 'shipped', 'delivered')
    );

  if reserved_lines > 0 and updated_rows = 0 then
    raise exception 'Could not return stock for this order.';
  end if;
end;
$$;

revoke execute on function public.apply_order_inventory_delta(uuid, integer)
from public, anon, authenticated;

grant execute on function public.apply_order_inventory_delta(uuid, integer)
to service_role;

create or replace function public.handle_order_inventory_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  should_release boolean;
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

  -- Payment and checkout never take stock. Only a later cancel/fail returns
  -- units that a supplier confirm already deducted.
  should_release := new.status = 'cancelled'
    or new.payment_status in ('failed', 'cancelled')
    or new.delivery_payment_status in ('failed', 'cancelled');

  if old.stock_reserved and should_release then
    perform public.apply_order_inventory_delta(new.id, 1);
    new.stock_reserved := false;
  end if;

  return new;
end;
$$;

revoke execute on function public.handle_order_inventory_reservation()
from public, anon, authenticated;

drop trigger if exists orders_inventory_reservation on public.orders;

create trigger orders_inventory_reservation
before update of status, payment_status, delivery_payment_status on public.orders
for each row
execute function public.handle_order_inventory_reservation();

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
    false,
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
    raise exception
      'Suppliers can only confirm orders. The admin team handles the delivery process.';
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
    raise exception 'This order has a pending cancellation request. Approve or reject it first.';
  end if;

  if placed_order.status = 'cancelled' then
    raise exception 'This order is cancelled.';
  end if;

  if placed_order.status = 'delivered' then
    raise exception 'This order is already delivered.';
  end if;

  if placed_order.delivery_payment_status is distinct from 'paid' then
    raise exception 'Wait for the retailer to pay the delivery charge before confirming this order.';
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

  if package_status is null or package_status = 'declined' then
    raise exception 'That supplier package is not available.';
  end if;

  if package_status is distinct from 'pending' then
    raise exception 'These items are not waiting for confirmation.';
  end if;

  -- Take this supplier's units now. Insufficient stock aborts the confirm.
  perform private.apply_seller_inventory_delta(p_order_id, v_supplier_id, -1);

  update public.order_supplier_acceptances
  set status = 'confirmed',
      accepted_at = coalesce(accepted_at, now()),
      declined_at = null,
      decline_reason = null
  where order_id = p_order_id
    and supplier_id = v_supplier_id;

  update public.orders
  set stock_reserved = true
  where id = p_order_id;

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
        else ' Delivery starts once admin initiates it.'
      end
  );

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select account.id,
    p_order_id,
    'order_confirmed',
    'Supplier confirmed items',
    supplier_name || ' confirmed their items on order #' || short_ref || '.'
      || case
        when pending_others > 0 then ''
        else ' You can start the delivery process.'
      end
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
  owed_declined_total numeric(12, 2) := 0;
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

  if placed_order.status = 'delivered' then
    raise exception 'Delivered orders can no longer be cancelled or refunded.';
  end if;

  if placed_order.cancel_requested then
    raise exception 'This order has a pending cancellation request. Approve or reject it first.';
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

  -- Pending packages never took stock, so decline does not return any.

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
      refund_due := greatest(
        round(public.order_merchandise_total(p_order_id) + prepaid_delivery, 2)
          - placed_order.refund_paid_total,
        0
      );
      refund_state := case when refund_due > 0 then 'pending' else 'not_required' end;
    elsif placed_order.payment_method = 'cod' and placed_order.delivery_payment_status = 'paid' then
      refund_due := greatest(round(prepaid_delivery, 2) - placed_order.refund_paid_total, 0);
      refund_state := case when refund_due > 0 then 'pending' else 'not_required' end;
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
      select round(coalesce(sum(item.quantity * item.unit_price), 0), 2)
      into owed_declined_total
      from public.order_items as item
      join public.order_supplier_acceptances as package
        on package.order_id = item.order_id
        and package.supplier_id = item.seller_id
      where item.order_id = p_order_id
        and package.status = 'declined';

      refund_due := greatest(owed_declined_total - placed_order.refund_paid_total, 0);
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
        then supplier_name || ' cancelled their items on order #' || short_ref || '. A merchandise refund of ' || to_char(refund_due, 'FM999999990.00') || ' BDT is pending. Remaining items are unaffected.'
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
  with expired as (
    update public.orders
    set payment_status = 'failed',
        delivery_payment_status = case
          when delivery_payment_status = 'paid' then delivery_payment_status
          else 'failed'
        end
    where status <> 'cancelled'
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
