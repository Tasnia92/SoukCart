-- Retailer-initiated cancellations retain prepaid delivery and never take a
-- separate platform charge. Supplier cancellations still refund merchandise +
-- delivery in full (COD delivery refund remains requestable by the retailer).

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
  retention numeric(12, 2) := 0;
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

  -- Platform charges are no longer used. Prepaid delivery is the retention on
  -- retailer/admin/support cancels. Keep the args for API compatibility.
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
        -- Supplier fault: full refund of merchandise + prepaid delivery.
        refund_due := round(merchandise_total + prepaid_delivery, 2);
        retention := 0;
      else
        -- Retailer/admin/support cancel: refund merchandise only.
        -- Prepaid delivery is retained; no separate platform charge.
        refund_due := round(merchandise_total, 2);
        retention := 0;
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
      -- COD retailer/admin cancel: prepaid delivery is not refunded.
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
          then 'Order #' || upper(substr(p_order_id::text, 1, 8)) || ' was cancelled. A manual refund of ' || to_char(refund_due, 'FM999999990.00') || ' BDT (merchandise + delivery) is pending.'
        when refund_state = 'pending'
          then 'Order #' || upper(substr(p_order_id::text, 1, 8)) || ' was cancelled. A manual refund of ' || to_char(refund_due, 'FM999999990.00') || ' BDT for merchandise is pending. Prepaid delivery is not refunded.'
        when placed_order.payment_method = 'cod'
          and placed_order.delivery_payment_status = 'paid'
          and resolved_initiator = 'supplier'
          then 'Order #' || upper(substr(p_order_id::text, 1, 8)) || ' was cancelled by the supplier. You can request a refund of the prepaid delivery charge.'
        when placed_order.payment_method = 'cod'
          and placed_order.delivery_payment_status = 'paid'
          then 'Order #' || upper(substr(p_order_id::text, 1, 8)) || ' was cancelled. Prepaid delivery is not refunded.'
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
