-- Delivery lifecycle, final shape:
--   retailer places order → suppliers confirm → admin initiates delivery →
--   suppliers update: dispatched → out for delivery → delivered.
-- Admin can no longer change or cancel orders. Retailer cancellation requests
-- are approved or rejected by the suppliers, and a supplier cancels directly
-- on single-supplier orders. Refund settlement and COD collection remain the
-- admin back office (money handling, not order lifecycle).

-- 1) Delivery initiation gate on orders.
alter table public.orders
  add column if not exists delivery_initiated_at timestamptz,
  add column if not exists delivery_initiated_by uuid references public.users (id);

-- Orders already moving keep working: treat them as initiated.
update public.orders
set delivery_initiated_at = coalesce(delivered_at, created_at)
where status in ('shipped', 'delivered')
  and delivery_initiated_at is null;

-- 2) Shipments gain the "dispatched" stage (created when the supplier hands
--    the parcel over; "out for delivery" is the next supplier update).
alter table public.order_shipments
  drop constraint if exists order_shipments_status_allowed;

alter table public.order_shipments
  add constraint order_shipments_status_allowed
  check (status in (
    'dispatched',
    'shipped',
    'in_transit',
    'out_for_delivery',
    'delivered',
    'exception'
  ));

alter table public.shipment_events
  drop constraint if exists shipment_events_event_type_allowed;

alter table public.shipment_events
  add constraint shipment_events_event_type_allowed
  check (event_type in (
    'created',
    'dispatched',
    'in_transit',
    'out_for_delivery',
    'delivered',
    'exception',
    'note'
  ));

-- 3) Admin initiates delivery once every supplier has confirmed.
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
    'Admin initiated delivery for order #' || short_ref
    || '. Mark the parcel dispatched, then out for delivery, then delivered.'
  from public.order_supplier_acceptances as package
  where package.order_id = p_order_id
    and package.status in ('confirmed', 'shipped', 'delivered');

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    placed_order.retailer_id,
    p_order_id,
    'delivery_initiated',
    'Delivery initiated',
    'Delivery was initiated for order #' || short_ref
    || '. Follow the delivery status as the suppliers update it.'
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

-- 4) Shared cancellation executor. Refund policy is unchanged:
--    supplier-initiated cancels refund merchandise + prepaid delivery in full;
--    retailer-initiated cancels refund merchandise only (prepaid delivery kept).
--    COD orders carry no automatic refund (delivery refund stays requestable).
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

  prepaid_delivery := coalesce(placed_order.delivery_charge, 0);
  merchandise_total := public.order_merchandise_total(p_order_id);
  short_ref := upper(substr(p_order_id::text, 1, 8));

  if placed_order.payment_method = 'online'
    and placed_order.payment_status = 'paid'
  then
    if p_initiator = 'supplier' then
      refund_due := round(merchandise_total + prepaid_delivery, 2);
    else
      refund_due := round(merchandise_total, 2);
    end if;
    refund_state := case when refund_due > 0 then 'pending' else 'not_required' end;
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
      when p_initiator = 'supplier' and refund_state = 'pending'
        then 'Order #' || short_ref || ' was cancelled by the supplier. A manual refund of '
          || to_char(refund_due, 'FM999999990.00') || ' BDT (merchandise + delivery) is pending.'
      when p_initiator = 'supplier'
        and placed_order.payment_method = 'cod'
        and placed_order.delivery_payment_status = 'paid'
        then 'Order #' || short_ref
          || ' was cancelled by the supplier. You can request a refund of the prepaid delivery charge.'
      when p_initiator = 'supplier'
        then 'Order #' || short_ref || ' was cancelled by the supplier.'
      when refund_state = 'pending'
        then 'Your cancellation request for order #' || short_ref
          || ' was approved. A manual refund of ' || to_char(refund_due, 'FM999999990.00')
          || ' BDT for merchandise is pending. Prepaid delivery is not refunded.'
      when placed_order.payment_method = 'cod'
        and placed_order.delivery_payment_status = 'paid'
        then 'Your cancellation request for order #' || short_ref
          || ' was approved. The order was cancelled; prepaid delivery is not refunded.'
      else 'Your cancellation request for order #' || short_ref || ' was approved.'
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
        then 'Order #' || short_ref || ' was cancelled. A full refund of any advance payment goes back to the retailer.'
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

-- 5) Suppliers confirm and own the whole delivery ladder after admin initiation:
--    dispatched → out for delivery → delivered. Legacy "shipped" calls are
--    treated as "dispatched".
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
  shipment_status text;
  delivery_step text;
begin
  if p_status not in ('confirmed', 'dispatched', 'shipped', 'out_for_delivery', 'delivered') then
    raise exception
      'Suppliers confirm orders and update delivery status: dispatched, out for delivery, or delivered.';
  end if;

  delivery_step := case when p_status = 'shipped' then 'dispatched' else p_status end;

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

  if placed_order.delivery_payment_status is distinct from 'paid' then
    raise exception 'Wait for the retailer to pay the delivery charge before fulfilling this order.';
  end if;

  if placed_order.payment_method is distinct from 'cod'
    and placed_order.payment_status is distinct from 'paid'
  then
    raise exception 'Wait for payment before fulfilling this order.';
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

  select shipment.status
  into shipment_status
  from public.order_shipments as shipment
  where shipment.order_id = p_order_id
    and shipment.seller_id = v_supplier_id;

  if delivery_step = 'confirmed' and package_status is distinct from 'pending' then
    raise exception 'These items are not waiting for confirmation.';
  end if;

  if delivery_step in ('dispatched', 'out_for_delivery', 'delivered')
    and placed_order.delivery_initiated_at is null
  then
    raise exception 'Delivery has not been initiated yet. The admin team starts delivery once every supplier confirms.';
  end if;

  if delivery_step = 'dispatched' and package_status is distinct from 'confirmed' then
    raise exception 'Confirm these items before marking them dispatched.';
  end if;

  if delivery_step = 'dispatched' and shipment_status in ('out_for_delivery', 'delivered') then
    raise exception 'These items are already on the way.';
  end if;

  if delivery_step = 'out_for_delivery' and package_status is distinct from 'shipped' then
    raise exception 'Mark these items dispatched before marking them out for delivery.';
  end if;

  if delivery_step = 'out_for_delivery' and shipment_status in ('out_for_delivery', 'delivered') then
    raise exception 'These items are already out for delivery.';
  end if;

  if delivery_step = 'delivered' and package_status is distinct from 'shipped' then
    raise exception 'Mark these items out for delivery before marking them delivered.';
  end if;

  if delivery_step = 'confirmed' then
    update public.order_supplier_acceptances
    set status = 'confirmed',
        accepted_at = coalesce(accepted_at, now()),
        declined_at = null,
        decline_reason = null
    where order_id = p_order_id
      and supplier_id = v_supplier_id;
  elsif delivery_step = 'dispatched' then
    update public.order_supplier_acceptances
    set status = 'shipped',
        declined_at = null,
        decline_reason = null
    where order_id = p_order_id
      and supplier_id = v_supplier_id;
  elsif delivery_step = 'delivered' then
    update public.order_supplier_acceptances
    set status = 'delivered'
    where order_id = p_order_id
      and supplier_id = v_supplier_id;
  end if;
  -- "out for delivery" keeps the package shipped; the parcel state moves on
  -- order_shipments below.

  insert into public.order_shipments (
    order_id,
    seller_id,
    carrier,
    tracking_number,
    status,
    notes
  )
  values (
    p_order_id,
    v_supplier_id,
    'Direct delivery',
    'N/A',
    case
      when delivery_step = 'confirmed' then 'dispatched'
      when delivery_step = 'dispatched' then 'dispatched'
      when delivery_step = 'out_for_delivery' then 'out_for_delivery'
      else 'delivered'
    end,
    case
      when delivery_step = 'dispatched' then 'Dispatched by the supplier.'
      else ''
    end
  )
  on conflict (order_id, seller_id) do update
    set status = excluded.status,
        updated_at = now();

  if delivery_step <> 'confirmed' then
    insert into public.shipment_events (shipment_id, event_type, message, created_by)
    select shipment.id,
      delivery_step,
      case
        when delivery_step = 'dispatched'
          then 'Supplier dispatched the parcel.'
        when delivery_step = 'out_for_delivery'
          then 'Supplier marked the parcel out for delivery.'
        else 'Supplier marked the parcel delivered.'
      end,
      v_supplier_id
    from public.order_shipments as shipment
    where shipment.order_id = p_order_id
      and shipment.seller_id = v_supplier_id;
  end if;

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
    case
      when delivery_step = 'confirmed' then 'order_confirmed'
      when delivery_step = 'dispatched' then 'order_dispatched'
      when delivery_step = 'out_for_delivery' then 'order_out_for_delivery'
      else 'order_delivered'
    end,
    case
      when delivery_step = 'confirmed' then 'Items confirmed'
      when delivery_step = 'dispatched' then 'Items dispatched'
      when delivery_step = 'out_for_delivery' then 'Items out for delivery'
      else 'Items delivered'
    end,
    case
      when delivery_step = 'confirmed'
        then supplier_name || ' confirmed their items on order #' || short_ref || '.'
          || case
            when pending_others > 0
              then ' Other items are still waiting for supplier confirmation.'
            else ' Delivery starts once admin initiates it.'
          end
      when delivery_step = 'dispatched'
        then 'Items from ' || supplier_name || ' on order #' || short_ref || ' have been dispatched.'
      when delivery_step = 'out_for_delivery'
        then 'Items from ' || supplier_name || ' on order #' || short_ref || ' are out for delivery.'
      else 'Items from ' || supplier_name || ' on order #' || short_ref
        || ' were marked delivered. Please confirm you received them.'
    end
  );

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select account.id,
    p_order_id,
    case
      when delivery_step = 'confirmed' then 'order_confirmed'
      when delivery_step = 'dispatched' then 'order_dispatched'
      when delivery_step = 'out_for_delivery' then 'order_out_for_delivery'
      else 'order_delivered'
    end,
    case
      when delivery_step = 'confirmed' then 'Supplier confirmed items'
      when delivery_step = 'dispatched' then 'Items dispatched'
      when delivery_step = 'out_for_delivery' then 'Items out for delivery'
      else 'Items delivered'
    end,
    case
      when delivery_step = 'confirmed'
        then supplier_name || ' confirmed their items on order #' || short_ref || '.'
          || case
            when pending_others > 0 then ''
            else ' You can initiate delivery.'
          end
      when delivery_step = 'dispatched'
        then supplier_name || ' dispatched their items on order #' || short_ref || '.'
      when delivery_step = 'out_for_delivery'
        then supplier_name || ' marked their items on order #' || short_ref || ' out for delivery.'
      else supplier_name || ' marked their items on order #' || short_ref || ' delivered.'
    end
  from public.users as account
  where account.role = 'admin';

  return p_status;
end;
$$;

revoke execute on function public.seller_set_order_status(uuid, text)
from public, anon;
grant execute on function public.seller_set_order_status(uuid, text)
to authenticated;

-- 6) Retailer asks to cancel before delivery. Delivered orders can no longer
--    be cancelled or refunded. The request is routed to the suppliers.
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
        then 'manual_keep_delivery'
      when placed_order.payment_method = 'cod'
        and placed_order.delivery_payment_status = 'paid'
        then 'delivery_not_refunded'
      else 'not_required'
    end
  );
end;
$$;

revoke execute on function public.request_order_cancellation(uuid)
from public, anon;
grant execute on function public.request_order_cancellation(uuid)
to authenticated;

-- 7) Supplier approves or rejects a retailer cancellation request. Any supplier
--    on the order can decide; the whole order is affected either way.
create or replace function public.seller_respond_order_cancellation(
  p_order_id uuid,
  p_approve boolean,
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
  short_ref text;
begin
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

  if not placed_order.cancel_requested
    or placed_order.cancellation_initiator is distinct from 'retailer'
  then
    raise exception 'There is no retailer cancellation request on this order.';
  end if;

  short_ref := upper(substr(p_order_id::text, 1, 8));

  if not p_approve then
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
      'The supplier rejected the cancellation request for order #' || short_ref
      || '. The order continues as normal.'
    from (
      select placed_order.retailer_id as id
      union
      select item.seller_id
      from public.order_items as item
      where item.order_id = p_order_id
        and item.seller_id is not null
        and item.seller_id is distinct from v_supplier_id
    ) as recipient;

    return jsonb_build_object(
      'id', p_order_id,
      'status', placed_order.status,
      'cancelRequested', false,
      'decision', 'rejected'
    );
  end if;

  return private.execute_order_cancellation(
    p_order_id,
    'retailer',
    v_supplier_id,
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), placed_order.cancellation_reason)
  );
end;
$$;

revoke execute on function public.seller_respond_order_cancellation(uuid, boolean, text)
from public, anon;
grant execute on function public.seller_respond_order_cancellation(uuid, boolean, text)
to authenticated;

-- 8) Supplier cancels directly on single-supplier orders (e.g. out of stock).
--    Multi-supplier orders are cancelled through the retailer's request.
create or replace function public.seller_cancel_order(
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
begin
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
    raise exception 'Only single-supplier orders can be cancelled directly. Ask the retailer to request a cancellation instead.';
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
    raise exception 'Delivered orders can no longer be cancelled. Open a return for a delivered order.';
  end if;

  -- A pending retailer request must be answered through the approve/reject RPC;
  -- a legacy supplier request is exactly what this call executes.
  if placed_order.cancel_requested
    and placed_order.cancellation_initiator = 'retailer'
  then
    raise exception 'A retailer cancellation request is pending. Approve or reject it instead.';
  end if;

  return private.execute_order_cancellation(p_order_id, 'supplier', v_supplier_id, p_reason);
end;
$$;

revoke execute on function public.seller_cancel_order(uuid, text)
from public, anon;
grant execute on function public.seller_cancel_order(uuid, text)
to authenticated;

-- 9) The old request/approval functions are retired:
--    admin no longer cancels or updates orders, and suppliers no longer send
--    cancellation requests to admin.
drop function if exists public.seller_request_order_cancellation(uuid, text);
drop function if exists public.admin_update_order_status(uuid, text, uuid, numeric, numeric);
drop function if exists public.admin_update_order_status(uuid, text, uuid, numeric, numeric, uuid);

-- 10) Supplier order feed gains the initiation gate and the parcel state.
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
      placed_order.delivery_initiated_at,
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
      (
        select shipment.status
        from public.order_shipments as shipment
        where shipment.order_id = placed_order.id
          and shipment.seller_id = (select auth.uid())
        limit 1
      ) as shipment_status,
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
grant execute on function public.supplier_orders()
to authenticated;

-- 11) Copy refresh: cancellation requests are now resolved by suppliers.
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
