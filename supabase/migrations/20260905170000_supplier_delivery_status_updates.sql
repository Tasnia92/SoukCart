-- Suppliers own the full delivery ladder: confirm → out for delivery (shipped)
-- → delivered. Admin no longer updates delivery status; admin order views are
-- monitoring only, with cancellation approval, refund settlement, and COD
-- collection kept as the admin back office.

-- 1) Suppliers confirm, mark out for delivery, and mark delivered.
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
  if p_status not in ('confirmed', 'shipped', 'delivered') then
    raise exception 'Suppliers confirm orders and update delivery status: confirm, out for delivery, or delivered.';
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
    raise exception 'This order has a cancellation request. Wait for the admin team.';
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

  if p_status = 'confirmed' and package_status is distinct from 'pending' then
    raise exception 'These items are not waiting for confirmation.';
  end if;

  if p_status = 'shipped' and package_status is distinct from 'confirmed' then
    raise exception 'Confirm these items before marking them out for delivery.';
  end if;

  if p_status = 'delivered' and package_status is distinct from 'shipped' then
    raise exception 'Mark these items out for delivery before marking them delivered.';
  end if;

  update public.order_supplier_acceptances
  set status = p_status,
      accepted_at = case when p_status = 'confirmed' then coalesce(accepted_at, now()) else accepted_at end,
      declined_at = null,
      decline_reason = null
  where order_id = p_order_id
    and supplier_id = v_supplier_id;

  -- Keep the per-supplier shipment row in step so the retailer timeline matches.
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
    case when p_status = 'delivered' then 'delivered' else 'shipped' end,
    case when p_status = 'shipped' then 'Marked out for delivery by the supplier.' else '' end
  )
  on conflict (order_id, seller_id) do update
    set status = case when p_status = 'delivered' then 'delivered' else excluded.status end,
        updated_at = now();

  if p_status = 'shipped' then
    insert into public.shipment_events (shipment_id, event_type, message, created_by)
    select shipment.id, 'out_for_delivery', 'Supplier marked the parcel out for delivery.', v_supplier_id
    from public.order_shipments as shipment
    where shipment.order_id = p_order_id
      and shipment.seller_id = v_supplier_id;
  elsif p_status = 'delivered' then
    insert into public.shipment_events (shipment_id, event_type, message, created_by)
    select shipment.id, 'delivered', 'Supplier marked the parcel delivered.', v_supplier_id
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
      when p_status = 'confirmed' then 'order_confirmed'
      when p_status = 'shipped' then 'order_shipped'
      else 'order_delivered'
    end,
    case
      when p_status = 'confirmed' then 'Items confirmed'
      when p_status = 'shipped' then 'Items out for delivery'
      else 'Items delivered'
    end,
    case
      when p_status = 'confirmed'
        then supplier_name || ' confirmed their items on order #' || short_ref || '.'
          || case
            when pending_others > 0
              then ' Other items are still waiting for supplier confirmation.'
            else ' You can follow delivery status here.'
          end
      when p_status = 'shipped'
        then 'Items from ' || supplier_name || ' on order #' || short_ref || ' are out for delivery.'
      else 'Items from ' || supplier_name || ' on order #' || short_ref || ' were marked delivered. Please confirm you received them.'
    end
  );

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select account.id,
    p_order_id,
    case
      when p_status = 'confirmed' then 'order_confirmed'
      when p_status = 'shipped' then 'order_shipped'
      else 'order_delivered'
    end,
    case
      when p_status = 'confirmed' then 'Supplier confirmed items'
      when p_status = 'shipped' then 'Items out for delivery'
      else 'Items delivered'
    end,
    case
      when p_status = 'confirmed'
        then supplier_name || ' confirmed their items on order #' || short_ref || '.'
      when p_status = 'shipped'
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

-- 2) Admin monitors orders. Only cancellation handling remains: approve
-- (cancel) or reject a pending request. Delivery status belongs to suppliers.
create or replace function public.admin_update_order_status(
  p_order_id uuid,
  p_status text,
  p_admin_id uuid,
  p_platform_charge numeric default 0,
  p_delivery_charge numeric default 0,
  p_supplier_id uuid default null
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

  if p_status not in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled') then
    raise exception 'Choose a valid order status.';
  end if;

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
  short_ref := upper(substr(p_order_id::text, 1, 8));

  -- Rejecting a pending cancellation request keeps the current status.
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
      'The admin team rejected the cancellation request for order #' || short_ref || '.'
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

  if p_status is distinct from 'cancelled' then
    raise exception 'Suppliers update delivery status. The admin team monitors orders and handles cancellations.';
  end if;

  if placed_order.status = 'cancelled' then
    raise exception 'A cancelled order cannot be changed.';
  end if;

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
      refund_due := round(merchandise_total, 2);
      retention := 0;
    end if;
    refund_state := case when refund_due > 0 then 'pending' else 'not_required' end;
  elsif placed_order.payment_method = 'cod'
    and placed_order.delivery_payment_status = 'paid'
    and resolved_initiator = 'supplier'
  then
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
      when refund_state = 'pending' and resolved_initiator = 'supplier'
        then 'Order #' || short_ref || ' was cancelled. A manual refund of ' || to_char(refund_due, 'FM999999990.00') || ' BDT (merchandise + delivery) is pending.'
      when refund_state = 'pending'
        then 'Order #' || short_ref || ' was cancelled. A manual refund of ' || to_char(refund_due, 'FM999999990.00') || ' BDT for merchandise is pending. Prepaid delivery is not refunded.'
      when placed_order.payment_method = 'cod'
        and placed_order.delivery_payment_status = 'paid'
        and resolved_initiator = 'supplier'
        then 'Order #' || short_ref || ' was cancelled by the supplier. You can request a refund of the prepaid delivery charge.'
      when placed_order.payment_method = 'cod'
        and placed_order.delivery_payment_status = 'paid'
        then 'Order #' || short_ref || ' was cancelled. Prepaid delivery is not refunded.'
      else 'Order #' || short_ref || ' was cancelled. No advance-payment refund is required.'
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
    'Order #' || short_ref || ' was cancelled. The admin team is handling any retailer refund manually.'
  from public.order_items as item
  where item.order_id = p_order_id
    and item.seller_id is not null;

  update public.order_supplier_acceptances
  set status = 'declined',
      declined_at = coalesce(declined_at, now()),
      decline_reason = coalesce(decline_reason, 'Order cancelled')
  where order_id = p_order_id
    and status in ('pending', 'confirmed');

  return jsonb_build_object(
    'id', p_order_id,
    'status', 'cancelled',
    'cancelRequested', false,
    'cancellationInitiator', resolved_initiator,
    'manualRefundStatus', refund_state,
    'refundAmount', refund_due,
    'platformCharge', retention,
    'deliveryCharge', prepaid_delivery,
    'supplierId', p_supplier_id
  );
end;
$$;

revoke execute on function public.admin_update_order_status(uuid, text, uuid, numeric, numeric, uuid)
from public, anon, authenticated;
grant execute on function public.admin_update_order_status(uuid, text, uuid, numeric, numeric, uuid)
to service_role;
