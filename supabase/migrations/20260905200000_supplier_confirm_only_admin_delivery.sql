-- Final delivery ownership split:
--   retailer places order → supplier notification → supplier confirms (or
--   cancels) → admin starts the delivery process and runs the whole delivery
--   ladder: dispatched → in transit → out for delivery → delivered.
-- Suppliers keep only two powers: confirm and cancel. Admin cannot confirm or
-- cancel orders — admin only moves delivery forward.
-- Once admin starts the delivery process, the order is locked: neither the
-- retailer nor the supplier can cancel it, and no refund policy applies.
-- Before delivery starts, any supplier-confirmed cancellation (supplier
-- cancels directly, or approves the retailer's request) refunds online orders
-- in full (merchandise + prepaid delivery) and gives COD orders the prepaid
-- delivery charge back. Both are settled manually by the admin team.

-- 1) Suppliers confirm only. The delivery ladder moves to the admin team.
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
        else ' Delivery starts once admin initiates it.'
      end
  );

  -- The confirmation notification lands on the admin dashboard: delivery is
  -- the admin team's to run from here.
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

-- 2) Admin owns the delivery ladder. Called through the admin edge function
--    (service_role), so the admin id is verified in the body. Moves every
--    parcel on the order forward: dispatched → in_transit → out_for_delivery
--    → delivered. Backwards moves and skipped steps are rejected.
create or replace function public.admin_update_delivery_status(
  p_order_id uuid,
  p_status text,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  placed_order public.orders%rowtype;
  short_ref text;
  parcel_status text;
  current_rank integer := -1;
  next_rank integer;
  event_message text;
begin
  if not exists (
    select 1
    from public.users as account
    where account.id = p_admin_id
      and account.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;

  if p_status not in ('dispatched', 'in_transit', 'out_for_delivery', 'delivered') then
    raise exception
      'Delivery status moves dispatched, in transit, out for delivery, then delivered.';
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
    raise exception 'This order is cancelled.';
  end if;

  if placed_order.delivery_initiated_at is null then
    raise exception 'Start the delivery process before updating the delivery status.';
  end if;

  -- Furthest any parcel has reached: never move a parcel backwards.
  select shipment.status
  into parcel_status
  from public.order_shipments as shipment
  where shipment.order_id = p_order_id
    and shipment.status in ('dispatched', 'shipped', 'in_transit', 'out_for_delivery', 'delivered')
  order by case shipment.status
      when 'delivered' then 3
      when 'out_for_delivery' then 2
      when 'in_transit' then 1
      else 0
    end desc
  limit 1;

  current_rank := case parcel_status
    when 'delivered' then 3
    when 'out_for_delivery' then 2
    when 'in_transit' then 1
    when 'dispatched' then 0
    when 'shipped' then 0
    else -1
  end;

  next_rank := case p_status
    when 'dispatched' then 0
    when 'in_transit' then 1
    when 'out_for_delivery' then 2
    else 3
  end;

  if next_rank <= current_rank then
    raise exception
      'These parcels already moved past that step. Delivery status only moves forward.';
  end if;

  if next_rank > current_rank + 1 then
    raise exception 'Follow the delivery steps in order: dispatched, in transit, out for delivery, delivered.';
  end if;

  perform private.ensure_order_packages(p_order_id);

  -- Every confirmed supplier parcel exists before the status moves.
  insert into public.order_shipments (
    order_id,
    seller_id,
    carrier,
    tracking_number,
    status,
    notes
  )
  select
    p_order_id,
    package.supplier_id,
    'Direct delivery',
    'N/A',
    'dispatched',
    'Parcel created by the admin delivery team.'
  from public.order_supplier_acceptances as package
  where package.order_id = p_order_id
    and package.status in ('confirmed', 'shipped')
  on conflict (order_id, seller_id) do nothing;

  event_message := case p_status
    when 'dispatched' then 'The admin team dispatched the parcel.'
    when 'in_transit' then 'The parcel is in transit.'
    when 'out_for_delivery' then 'The parcel is out for delivery.'
    else 'The admin team marked the parcel delivered.'
  end;

  with moved as (
    update public.order_shipments as shipment
    set status = p_status,
        updated_at = now()
    where shipment.order_id = p_order_id
      and shipment.status is distinct from 'delivered'
    returning shipment.id
  )
  insert into public.shipment_events (shipment_id, event_type, message, created_by)
  select moved.id, p_status, event_message, p_admin_id
  from moved;

  if p_status = 'delivered' then
    update public.order_supplier_acceptances
    set status = 'delivered'
    where order_id = p_order_id
      and status in ('confirmed', 'shipped');
  else
    update public.order_supplier_acceptances
    set status = 'shipped'
    where order_id = p_order_id
      and status = 'confirmed';
  end if;

  perform private.sync_order_status_from_packages(p_order_id);

  short_ref := upper(substr(p_order_id::text, 1, 8));

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    placed_order.retailer_id,
    p_order_id,
    case
      when p_status = 'dispatched' then 'order_dispatched'
      when p_status = 'in_transit' then 'order_in_transit'
      when p_status = 'out_for_delivery' then 'order_out_for_delivery'
      else 'order_delivered'
    end,
    case
      when p_status = 'dispatched' then 'Order dispatched'
      when p_status = 'in_transit' then 'Order in transit'
      when p_status = 'out_for_delivery' then 'Out for delivery'
      else 'Order delivered'
    end,
    case
      when p_status = 'dispatched'
        then 'Order #' || short_ref || ' was dispatched by the admin delivery team.'
      when p_status = 'in_transit'
        then 'Order #' || short_ref || ' is in transit.'
      when p_status = 'out_for_delivery'
        then 'Order #' || short_ref || ' is out for delivery.'
      else 'Order #' || short_ref
        || ' was delivered. Please confirm you received it.'
    end
  );

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select distinct item.seller_id,
    p_order_id,
    case
      when p_status = 'dispatched' then 'order_dispatched'
      when p_status = 'in_transit' then 'order_in_transit'
      when p_status = 'out_for_delivery' then 'order_out_for_delivery'
      else 'order_delivered'
    end,
    'Delivery updated',
    'The admin team marked order #' || short_ref || ' as '
      || replace(p_status, '_', ' ') || '.'
  from public.order_items as item
  where item.order_id = p_order_id
    and item.seller_id is not null;

  return jsonb_build_object(
    'id', p_order_id,
    'deliveryStatus', p_status,
    'orderStatus', case
      when p_status = 'delivered' then 'delivered'
      else 'shipped'
    end
  );
end;
$$;

revoke execute on function public.admin_update_delivery_status(uuid, text, uuid)
from public, anon, authenticated;
grant execute on function public.admin_update_delivery_status(uuid, text, uuid)
to service_role;

-- 3) Shared cancellation executor. The delivery-start lockout lives here so
--    every caller (supplier direct cancel, supplier approving the retailer's
--    request) is covered: once admin started delivery, nobody cancels and no
--    refund applies. Before that, online orders refund in full and COD orders
--    get the prepaid delivery charge back.
create or replace function private.execute_order_cancellation(
  p_order_id uuid,
  p_initiator text,
  p_actor_id uuid,
  p_reason text default null
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
  short_ref text;
  reason text;
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
    raise exception 'This order is already cancelled.';
  end if;

  if placed_order.status = 'delivered' then
    raise exception 'Delivered orders can no longer be cancelled or refunded.';
  end if;

  -- The lockout: once admin started the delivery process the order is final.
  -- No cancellation from the retailer or the supplier dashboard, and no
  -- refund policy applies.
  if placed_order.delivery_initiated_at is not null
    or placed_order.status = 'shipped'
  then
    raise exception
      'The delivery process has started. This order can no longer be cancelled or refunded.';
  end if;

  prepaid_delivery := coalesce(placed_order.delivery_charge, 0);
  merchandise_total := public.order_merchandise_total(p_order_id);
  short_ref := upper(substr(p_order_id::text, 1, 8));

  if placed_order.payment_method = 'online'
    and placed_order.payment_status = 'paid'
  then
    -- Online: everything the retailer paid comes back.
    refund_due := round(merchandise_total + prepaid_delivery, 2);
    refund_state := case when refund_due > 0 then 'pending' else 'not_required' end;
  elsif placed_order.payment_method = 'cod'
    and placed_order.delivery_payment_status = 'paid'
  then
    -- COD collects merchandise in cash, so only the prepaid delivery charge
    -- comes back, automatically queued for the admin team.
    if prepaid_delivery > 0 then
      refund_due := round(prepaid_delivery, 2);
      refund_state := 'pending';
    end if;
  end if;

  reason := coalesce(
    nullif(btrim(coalesce(p_reason, '')), ''),
    placed_order.cancellation_reason,
    case
      when p_initiator = 'supplier' then 'Supplier cancelled the order'
      else 'Retailer requested cancellation'
    end
  );

  update public.orders
  set status = 'cancelled',
      cancel_requested = false,
      cancel_requested_at = null,
      cancellation_initiator = p_initiator,
      cancellation_requested_by = case
        when p_initiator = 'retailer' then cancellation_requested_by
        else p_actor_id
      end,
      cancellation_reason = reason,
      cancelled_at = now(),
      cancelled_by = p_actor_id,
      platform_charge = 0,
      refund_amount = refund_due,
      manual_refund_status = refund_state,
      refund_completed_at = null,
      refund_completed_by = null
  where id = p_order_id;
  -- The orders_inventory_reservation trigger releases stock and the payout
  -- reversal trigger refunds accrued seller earnings automatically.

  update public.order_supplier_acceptances
  set status = 'declined',
      declined_at = coalesce(declined_at, now()),
      decline_reason = coalesce(decline_reason, 'Order cancelled')
  where order_id = p_order_id
    and status in ('pending', 'confirmed', 'shipped');

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select distinct recipient.id,
    p_order_id,
    'order_cancelled',
    'Order cancelled',
    case
      when refund_state = 'pending' and placed_order.payment_method = 'cod'
        then 'Order #' || short_ref || ' was cancelled. A manual refund of '
          || to_char(refund_due, 'FM999999990.00') || ' BDT for the prepaid delivery charge is pending.'
      when refund_state = 'pending'
        then 'Order #' || short_ref || ' was cancelled. A full manual refund of '
          || to_char(refund_due, 'FM999999990.00')
          || ' BDT (merchandise + delivery) is pending.'
      else 'Order #' || short_ref || ' was cancelled. No advance-payment refund is required.'
    end
  from (
    select account.id
    from public.users as account
    where account.role = 'admin'
    union
    select placed_order.retailer_id
  ) as recipient;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select distinct item.seller_id,
    p_order_id,
    'order_cancelled',
    'Order cancelled',
    case
      when p_initiator = 'supplier'
        then 'Order #' || short_ref || ' was cancelled. Any advance payment the retailer made is refunded manually by the admin team.'
      else 'Order #' || short_ref
        || ' was cancelled after a supplier approved the retailer''s cancellation request.'
    end
  from public.order_items as item
  where item.order_id = p_order_id
    and item.seller_id is not null;

  return jsonb_build_object(
    'id', p_order_id,
    'status', 'cancelled',
    'cancelRequested', false,
    'cancellationInitiator', p_initiator,
    'manualRefundStatus', refund_state,
    'refundAmount', refund_due,
    'deliveryCharge', prepaid_delivery
  );
end;
$$;

revoke all on function private.execute_order_cancellation(uuid, text, uuid, text) from public;
grant execute on function private.execute_order_cancellation(uuid, text, uuid, text)
to service_role;

-- 4) Retailer cancellation requests are rejected outright once delivery
--    started, and the up-front refund hint matches the policy: online orders
--    refund in full, COD orders get the delivery charge back.
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

  if placed_order.status = 'delivered' then
    raise exception 'Delivered orders can no longer be cancelled or refunded. Once an order is marked delivered, the refund window is closed.';
  end if;

  -- Locked once admin starts the delivery process.
  if placed_order.delivery_initiated_at is not null
    or placed_order.status = 'shipped'
  then
    raise exception
      'The delivery process has started. This order can no longer be cancelled or refunded.';
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
  select distinct item.seller_id,
    p_order_id,
    'order_cancellation_requested',
    'Cancellation request to review',
    'The retailer requested cancellation of order #'
    || upper(substr(p_order_id::text, 1, 8))
    || '. Approve or reject it from your orders page.'
  from public.order_items as item
  where item.order_id = p_order_id
    and item.seller_id is not null;

  return jsonb_build_object(
    'status', 'requested',
    'initiator', 'retailer',
    'refundPolicy', case
      when placed_order.payment_method = 'online' and placed_order.payment_status = 'paid'
        then 'manual_full'
      when placed_order.payment_method = 'cod'
        and placed_order.delivery_payment_status = 'paid'
        then 'delivery_full'
      else 'not_required'
    end
  );
end;
$$;

revoke execute on function public.request_order_cancellation(uuid)
from public, anon;
grant execute on function public.request_order_cancellation(uuid)
to authenticated;

-- 5) Copy refresh on the initiation gate: suppliers no longer touch parcels,
--    the admin team keeps the delivery status up to date.
create or replace function public.admin_initiate_delivery(
  p_order_id uuid,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  placed_order public.orders%rowtype;
  pending_packages integer := 0;
  active_packages integer := 0;
  initiated_at timestamptz;
  short_ref text;
begin
  if not exists (
    select 1
    from public.users as account
    where account.id = p_admin_id
      and account.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
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
    raise exception 'This order is cancelled.';
  end if;

  if placed_order.cancel_requested then
    raise exception 'This order has a pending cancellation request.';
  end if;

  if placed_order.delivery_initiated_at is not null then
    raise exception 'Delivery has already been initiated for this order.';
  end if;

  if placed_order.delivery_payment_status is distinct from 'paid'
    or (
      placed_order.payment_method is distinct from 'cod'
      and placed_order.payment_status is distinct from 'paid'
    )
  then
    raise exception 'Delivery can be initiated only after the order is fully paid.';
  end if;

  if placed_order.status is distinct from 'confirmed' then
    raise exception 'Wait for the suppliers to confirm their items before initiating delivery.';
  end if;

  perform private.ensure_order_packages(p_order_id);

  select
    count(*) filter (where package.status = 'pending'),
    count(*) filter (where package.status <> 'declined')
  into pending_packages, active_packages
  from public.order_supplier_acceptances as package
  where package.order_id = p_order_id;

  if active_packages = 0 then
    raise exception 'No supplier packages are confirmed for this order.';
  end if;

  if pending_packages > 0 then
    raise exception 'All suppliers must confirm their items before delivery can be initiated.';
  end if;

  initiated_at := now();

  update public.orders
  set delivery_initiated_at = initiated_at,
      delivery_initiated_by = p_admin_id
  where id = p_order_id;

  short_ref := upper(substr(p_order_id::text, 1, 8));

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select distinct package.supplier_id,
    p_order_id,
    'delivery_initiated',
    'Delivery initiated',
    'Admin started the delivery process for order #' || short_ref
    || '. The order is now locked: it can no longer be cancelled. The admin team keeps the delivery status up to date.'
  from public.order_supplier_acceptances as package
  where package.order_id = p_order_id
    and package.status in ('confirmed', 'shipped', 'delivered');

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    placed_order.retailer_id,
    p_order_id,
    'delivery_initiated',
    'Delivery initiated',
    'Delivery started for order #' || short_ref
    || '. The order can no longer be cancelled. Follow the delivery status from your orders page.'
  );

  return jsonb_build_object(
    'id', p_order_id,
    'status', placed_order.status,
    'deliveryInitiatedAt', initiated_at
  );
end;
$$;

revoke execute on function public.admin_initiate_delivery(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_initiate_delivery(uuid, uuid)
to service_role;

-- 6) Supplier order feed: unchanged shape, parcel state stays read-only for
--    suppliers. Recreated so the comment matches the new ownership split.
comment on function public.seller_set_order_status(uuid, text) is
  'Suppliers confirm their items on an order. Delivery is handled by the admin team.';
comment on function public.admin_update_delivery_status(uuid, text, uuid) is
  'Admin delivery ladder: dispatched → in transit → out for delivery → delivered.';
comment on function private.execute_order_cancellation(uuid, text, uuid, text) is
  'Supplier-confirmed cancellation. Locked once delivery starts; refunds online orders in full and COD orders the prepaid delivery charge before that.';
