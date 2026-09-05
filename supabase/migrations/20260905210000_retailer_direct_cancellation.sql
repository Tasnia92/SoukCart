-- Retailer cancellations no longer wait for supplier approval. Before the
-- delivery process starts, the retailer cancels the order directly — whether
-- they paid online or chose cash on delivery. Refunds are still applied by the
-- shared executor: online orders refund in full, COD orders get the prepaid
-- delivery charge back, all settled manually by the admin team.

-- 1) Shared cancellation executor, unchanged except the notification copy: a
--    retailer-initiated cancellation is no longer "approved by a supplier".
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
      else 'Retailer cancelled the order before delivery'
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
        || ' was cancelled by the retailer before delivery started. Any advance payment the retailer made is refunded manually by the admin team.'
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

-- 2) Retailer cancels directly. No supplier approval step: as long as the
--    delivery process has not started, the order is cancelled on the spot —
--    online payments and cash on delivery alike. The refund policy is applied
--    by the shared executor and settled manually by the admin team.
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

  return private.execute_order_cancellation(
    p_order_id,
    'retailer',
    requester_id,
    'Retailer cancelled the order before delivery'
  );
end;
$$;

revoke execute on function public.request_order_cancellation(uuid)
from public, anon;
grant execute on function public.request_order_cancellation(uuid)
to authenticated;

comment on function public.request_order_cancellation(uuid) is
  'Retailer cancels their own order directly before delivery starts — no supplier approval. Online orders refund in full and COD orders get the prepaid delivery charge back, settled manually by the admin team.';
