-- Refund policy keyed to the delivery stage:
--   * Delivered orders can never be cancelled, returned, or refunded — the
--     retailer can only open a complaint (cancellation_refund category).
--   * Before the parcel is out for delivery, a supplier-confirmed cancellation
--     (supplier cancels directly, or approves the retailer's request) refunds
--     everything the retailer paid in advance: merchandise + delivery for
--     online orders, the prepaid delivery charge for COD orders. The COD
--     delivery refund is queued automatically instead of waiting for the
--     retailer to request it.
--   * Once the parcel is out for delivery the courier cost is sunk: only the
--     merchandise is refunded (online orders) and the prepaid delivery charge
--     is kept, no matter who initiated the cancellation.
-- The retailer-facing return request on delivered orders is removed; that path
-- is complaints only. Supplier-opened returns are unaffected.

-- 1) Shared cancellation executor with stage-aware refunds. Every caller is a
--    supplier (direct cancel, or approving the retailer's request), so every
--    executed cancellation is supplier-confirmed.
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
  parcel_out boolean := false;
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
    raise exception 'Delivered orders can no longer be cancelled or refunded. The retailer can open a complaint instead.';
  end if;

  -- The delivery charge is only refundable before the parcel goes out for
  -- delivery. Once any parcel on the order reached the doorstep stage the
  -- courier cost is sunk and the prepaid delivery stays with the platform.
  select exists (
    select 1
    from public.order_shipments as shipment
    where shipment.order_id = p_order_id
      and shipment.status in ('out_for_delivery', 'delivered')
  )
  into parcel_out;

  prepaid_delivery := coalesce(placed_order.delivery_charge, 0);
  merchandise_total := public.order_merchandise_total(p_order_id);
  short_ref := upper(substr(p_order_id::text, 1, 8));

  if placed_order.payment_method = 'online'
    and placed_order.payment_status = 'paid'
  then
    refund_due := case
      when parcel_out then round(merchandise_total, 2)
      else round(merchandise_total + prepaid_delivery, 2)
    end;
    refund_state := case when refund_due > 0 then 'pending' else 'not_required' end;
  elsif placed_order.payment_method = 'cod'
    and placed_order.delivery_payment_status = 'paid'
  then
    -- COD collects merchandise in cash, so only the prepaid delivery charge
    -- can come back, automatically, while the parcel has not gone out yet.
    if not parcel_out and prepaid_delivery > 0 then
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
      when refund_state = 'pending' and parcel_out
        then 'Order #' || short_ref || ' was cancelled. A manual refund of '
          || to_char(refund_due, 'FM999999990.00') || ' BDT for merchandise is pending. The prepaid delivery charge is kept because the parcel was out for delivery.'
      when refund_state = 'pending' and placed_order.payment_method = 'cod'
        then 'Order #' || short_ref || ' was cancelled. A manual refund of '
          || to_char(refund_due, 'FM999999990.00') || ' BDT for the prepaid delivery charge is pending.'
      when refund_state = 'pending'
        then 'Order #' || short_ref || ' was cancelled. A manual refund of '
          || to_char(refund_due, 'FM999999990.00') || ' BDT (merchandise + delivery) is pending.'
      when placed_order.payment_method = 'cod'
        and placed_order.delivery_payment_status = 'paid'
        and parcel_out
        then 'Order #' || short_ref || ' was cancelled. The prepaid delivery charge is kept because the parcel was out for delivery.'
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
    'parcelOutOfDelivery', parcel_out,
    'manualRefundStatus', refund_state,
    'refundAmount', refund_due,
    'deliveryCharge', prepaid_delivery
  );
end;
$$;

-- 2) Retailer cancellation request: hint at the stage-based outcome up front.
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

-- 3) When every supplier declines (whole order dies before delivery), the COD
--    prepaid delivery charge is refunded automatically, same as a direct
--    supplier cancellation.
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
      refund_due := round(prepaid_delivery, 2);
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

-- 4) Retailers can no longer ask for a return on delivered orders — the
--    post-delivery path is a complaint only. Supplier-opened returns stay.
drop function if exists public.request_order_return(uuid, uuid, text);
