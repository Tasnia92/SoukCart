-- Remove Pathao courier. Admin updates delivery status; retailer and supplier see it.

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
grant execute on function public.supplier_orders() to authenticated;

-- Suppliers confirm only. Admin owns shipped / delivered.
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
  if p_status is distinct from 'confirmed' then
    raise exception 'Suppliers can confirm orders. Admin updates delivery status.';
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

  if placed_order.status is distinct from 'pending' then
    raise exception 'Choose the next valid order status.';
  end if;

  if placed_order.delivery_payment_status is distinct from 'paid' then
    raise exception 'Wait for the retailer to pay the delivery charge before fulfilling this order.';
  end if;

  if placed_order.payment_method is distinct from 'cod'
    and placed_order.payment_status is distinct from 'paid'
  then
    raise exception 'Wait for payment before confirming this order.';
  end if;

  update public.orders
  set status = 'confirmed'
  where id = p_order_id;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    placed_order.retailer_id,
    p_order_id,
    'order_confirmed',
    'Order confirmed',
    'The supplier confirmed order #' || upper(substr(p_order_id::text, 1, 8)) || '. Admin will update delivery next.'
  );

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select account.id,
    p_order_id,
    'order_confirmed',
    'Order confirmed',
    'Order #' || upper(substr(p_order_id::text, 1, 8)) || ' was confirmed. Mark it shipped when the parcel leaves.'
  from public.users as account
  where account.role = 'admin';

  return 'confirmed';
end;
$$;

revoke execute on function public.seller_set_order_status(uuid, text)
from public, anon;
grant execute on function public.seller_set_order_status(uuid, text)
to authenticated;

revoke execute on function public.seller_ship_order(uuid, text, text, text, text)
from public, anon, authenticated;

revoke execute on function public.seller_update_shipment(uuid, text, text, text, text, text, text)
from public, anon, authenticated;

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

    update public.order_shipments
    set status = case
          when p_status = 'delivered' then 'delivered'
          when p_status = 'shipped' then 'shipped'
          else status
        end,
        updated_at = now()
    where order_id = p_order_id
      and p_status in ('shipped', 'delivered');

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
        when p_status = 'confirmed' then 'Order confirmed'
        when p_status = 'shipped' then 'Order shipped'
        else 'Order delivered'
      end,
      case
        when p_status = 'confirmed' then 'Order #' || short_ref || ' was confirmed.'
        when p_status = 'shipped' then 'Order #' || short_ref || ' is on the way.'
        else 'Order #' || short_ref || ' was marked delivered. Please confirm you received it.'
      end
    );

    insert into public.notifications (recipient_id, order_id, type, title, message)
    select distinct item.seller_id,
      p_order_id,
      case
        when p_status = 'confirmed' then 'order_confirmed'
        when p_status = 'shipped' then 'order_shipped'
        else 'order_delivered'
      end,
      case
        when p_status = 'confirmed' then 'Order confirmed'
        when p_status = 'shipped' then 'Order shipped'
        else 'Order delivered'
      end,
      case
        when p_status = 'confirmed' then 'Order #' || short_ref || ' was confirmed.'
        when p_status = 'shipped' then 'Order #' || short_ref || ' was marked shipped by admin.'
        else 'Order #' || short_ref || ' was marked delivered by admin.'
      end
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id is not null;
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

drop function if exists public.service_upsert_pathao_token(text, text, timestamptz);
drop function if exists public.service_get_pathao_token();
drop function if exists public.service_create_pathao_shipment(uuid, uuid, text, text, numeric, text, text, numeric);
drop function if exists public.service_apply_pathao_event(text, text, text, text, numeric, numeric, text, timestamptz);

drop table if exists private.pathao_oauth_tokens;

update public.order_shipments
set provider = 'manual'
where provider is distinct from 'manual';

drop index if exists public.order_shipments_consignment_id_uidx;

alter table public.order_shipments
  drop constraint if exists order_shipments_provider_check;

alter table public.order_shipments
  drop constraint if exists order_shipments_pathao_delivery_fee_check;

alter table public.order_shipments
  drop column if exists consignment_id,
  drop column if exists pathao_status,
  drop column if exists pathao_delivery_fee;

alter table public.order_shipments
  add constraint order_shipments_provider_check
    check (provider in ('manual'));
