-- Revenue and refund math integrity.
--
-- Canonical money rules:
--   1. Money is ADDED to revenue only when the order is delivered AND payment
--      is captured (online gateway paid, or COD cash recorded). This was
--      already the seller_payouts accrual gate; it is now also what the
--      dashboards report, and it explicitly requires the prepaid delivery
--      charge to be paid as well.
--   2. Money LEAVES as a refund when the admin completes a manual refund
--      (tracked cumulatively in orders.refund_paid_total) or when a supplier
--      records an order return as refunded (which now claws the merchandise
--      and its commission back out of the seller's payout ledger).
--   3. Refund amounts are always NET of what was already refunded, so no
--      retailer can be refunded twice for the same money.
--
-- Fixes included here:
--   a. orders.refund_paid_total — cumulative refund actually paid to the
--      retailer. Every new refund computation nets against it.
--   b. admin_complete_manual_refund accumulates refund_paid_total and may now
--      complete refunds on live orders (partial supplier declines).
--   c. execute_order_cancellation and seller_decline_order_items compute the
--      outstanding refund net of refund_paid_total — no double refunds after
--      partial declines, and COD orders whose suppliers all decline get the
--      prepaid delivery charge queued for refund just like a cancellation.
--   d. The manual refund state check now allows pending/completed refunds on
--      live orders (partial declines keep the order open while a refund is
--      pending).
--   e. order_returns.refund_applied + payout clawback: marking a return
--      refunded reduces the seller's payout (gross, commission, net) and the
--      accrual helper nets applied return refunds, so supplier earnings and
--      platform commission both fall when merchandise is refunded.

-- ---------------------------------------------------------------------------
-- 1. Cumulative refund ledger on orders
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists refund_paid_total numeric(12, 2) not null default 0;

alter table public.orders
  drop constraint if exists orders_refund_paid_total_check;

alter table public.orders
  add constraint orders_refund_paid_total_check check (refund_paid_total >= 0);

-- Historical completed refunds count as money already paid back.
update public.orders
set refund_paid_total = refund_amount
where manual_refund_status = 'completed'
  and refund_amount > 0;

-- Pending/completed refunds may sit on a live order after a supplier
-- partially declined items; the order keeps fulfilling while the refund waits.
alter table public.orders
  drop constraint if exists orders_manual_refund_state_check;

alter table public.orders
  add constraint orders_manual_refund_state_check
  check (
    (
      manual_refund_status = 'not_required'
      and refund_amount = 0
      and refund_completed_at is null
      and refund_completed_by is null
    )
    or (
      manual_refund_status = 'review_required'
      and status = 'cancelled'
      and payment_method = 'online'
      and payment_status = 'paid'
      and refund_amount = 0
      and refund_completed_at is null
      and refund_completed_by is null
    )
    or (
      manual_refund_status = 'pending'
      and refund_amount > 0
      and refund_completed_at is null
      and refund_completed_by is null
      and (
        (payment_method = 'online' and payment_status = 'paid')
        or (payment_method = 'cod' and delivery_payment_status = 'paid')
      )
    )
    or (
      manual_refund_status = 'completed'
      and refund_amount > 0
      and refund_completed_at is not null
      and refund_completed_by is not null
      and (
        (payment_method = 'online' and payment_status = 'paid')
        or (payment_method = 'cod' and delivery_payment_status = 'paid')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Completing a manual refund books the money as paid
-- ---------------------------------------------------------------------------

create or replace function public.admin_complete_manual_refund(
  p_order_id uuid,
  p_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed_order public.orders%rowtype;
begin
  if not exists (
    select 1
    from public.users as account
    where account.id = p_admin_id
      and account.role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;

  -- The refunded amount becomes part of the cumulative refund ledger, so any
  -- later refund computation nets against it. Live orders (partial supplier
  -- declines) can have pending refunds too, so no status filter here.
  update public.orders
  set manual_refund_status = 'completed',
      refund_paid_total = refund_paid_total + refund_amount,
      refund_completed_at = now(),
      refund_completed_by = p_admin_id
  where id = p_order_id
    and manual_refund_status = 'pending'
  returning * into completed_order;

  if completed_order.id is null then
    raise exception 'This order does not have a pending manual refund.';
  end if;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select distinct recipient.id,
    p_order_id,
    'manual_refund_completed',
    'Refund completed',
    'The admin completed the manual refund of ' || to_char(completed_order.refund_amount, 'FM999999990.00') || ' BDT for order #' || upper(substr(p_order_id::text, 1, 8)) || '.'
  from (
    select account.id
    from public.users as account
    where account.role = 'admin'
      and account.id <> p_admin_id
    union
    select completed_order.retailer_id
  ) as recipient;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select distinct coalesce(item.seller_id, product.seller_id),
    p_order_id,
    'manual_refund_completed',
    'Retailer refund completed',
    'The admin completed the retailer refund for order #' || upper(substr(p_order_id::text, 1, 8)) || '.'
  from public.order_items as item
  left join public.products as product on product.id = item.product_id
  where item.order_id = p_order_id
    and coalesce(item.seller_id, product.seller_id) is not null;

  return jsonb_build_object(
    'id', p_order_id,
    'manualRefundStatus', 'completed',
    'refundAmount', completed_order.refund_amount,
    'refundPaidTotal', completed_order.refund_paid_total,
    'refundCompletedAt', completed_order.refund_completed_at
  );
end;
$$;

revoke execute on function public.admin_complete_manual_refund(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_complete_manual_refund(uuid, uuid)
to service_role;

-- ---------------------------------------------------------------------------
-- 3. Cancellation refunds are net of what was already refunded
-- ---------------------------------------------------------------------------

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
    -- Online: everything the retailer paid comes back, minus anything the
    -- admin team already refunded (e.g. for declined supplier items).
    refund_due := greatest(
      round(merchandise_total + prepaid_delivery, 2) - placed_order.refund_paid_total,
      0
    );
    refund_state := case when refund_due > 0 then 'pending' else 'not_required' end;
  elsif placed_order.payment_method = 'cod'
    and placed_order.delivery_payment_status = 'paid'
  then
    -- COD collects merchandise in cash, so only the prepaid delivery charge
    -- comes back, automatically queued for the admin team.
    refund_due := greatest(round(prepaid_delivery, 2) - placed_order.refund_paid_total, 0);
    refund_state := case when refund_due > 0 then 'pending' else 'not_required' end;
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
    'refundPaidTotal', placed_order.refund_paid_total,
    'deliveryCharge', prepaid_delivery
  );
end;
$$;

revoke all on function private.execute_order_cancellation(uuid, text, uuid, text) from public;
grant execute on function private.execute_order_cancellation(uuid, text, uuid, text)
to service_role;

-- ---------------------------------------------------------------------------
-- 4. Supplier declines: refund outstanding amounts only, never double-pay
-- ---------------------------------------------------------------------------

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
    -- Every supplier declined: the order dies, so the full cancellation
    -- refund policy applies. Refund whatever the retailer paid and has not
    -- been refunded yet.
    if placed_order.payment_method = 'online' and placed_order.payment_status = 'paid' then
      refund_due := greatest(
        round(public.order_merchandise_total(p_order_id) + prepaid_delivery, 2)
          - placed_order.refund_paid_total,
        0
      );
      refund_state := case when refund_due > 0 then 'pending' else 'not_required' end;
    elsif placed_order.payment_method = 'cod' and placed_order.delivery_payment_status = 'paid' then
      -- COD merchandise was never collected, but the delivery charge was
      -- prepaid: it comes back, same as a cancellation.
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
      -- Partial decline: every declined supplier's merchandise is owed back,
      -- minus anything already refunded. Never accumulate on top of a
      -- completed refund — that would pay the retailer twice.
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

-- ---------------------------------------------------------------------------
-- 5. COD delivery-charge refund request nets against the refund ledger
-- ---------------------------------------------------------------------------

create or replace function public.request_cod_delivery_refund(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_id uuid := (select auth.uid());
  placed_order public.orders%rowtype;
  refund_due numeric(12, 2) := 0;
begin
  if requester_id is null or not exists (
    select 1
    from public.users as account
    where account.id = requester_id
      and account.role = 'retailer'
  ) then
    raise exception 'A retailer account is required to request a delivery refund.';
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

  if placed_order.status is distinct from 'cancelled' then
    raise exception 'Only cancelled orders can request a delivery refund.';
  end if;

  if placed_order.payment_method is distinct from 'cod' then
    raise exception 'Delivery refund requests are only for cash on delivery orders.';
  end if;

  if placed_order.delivery_payment_status is distinct from 'paid' then
    raise exception 'No prepaid delivery charge was collected for this order.';
  end if;

  if placed_order.cancellation_initiator is distinct from 'supplier' then
    raise exception 'Delivery refunds can be requested when the supplier cancelled the order.';
  end if;

  if placed_order.manual_refund_status = 'pending' then
    raise exception 'A delivery refund is already pending.';
  end if;

  if placed_order.manual_refund_status = 'completed' then
    raise exception 'This delivery refund was already completed.';
  end if;

  refund_due := greatest(
    round(coalesce(placed_order.delivery_charge, 0), 2) - placed_order.refund_paid_total,
    0
  );

  if refund_due <= 0 then
    raise exception 'The prepaid delivery charge was already refunded.';
  end if;

  update public.orders
  set refund_amount = refund_due,
      manual_refund_status = 'pending',
      refund_completed_at = null,
      refund_completed_by = null
  where id = p_order_id;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select account.id,
    p_order_id,
    'delivery_refund_requested',
    'Delivery refund requested',
    'Retailer requested a refund of the prepaid delivery charge for cancelled order #' || upper(substr(p_order_id::text, 1, 8)) || '.'
  from public.users as account
  where account.role = 'admin';

  return jsonb_build_object(
    'id', p_order_id,
    'manualRefundStatus', 'pending',
    'refundAmount', refund_due
  );
end;
$$;

revoke execute on function public.request_cod_delivery_refund(uuid)
from public, anon;
grant execute on function public.request_cod_delivery_refund(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Return refunds claw money back out of the seller payout ledger
-- ---------------------------------------------------------------------------

alter table public.order_returns
  add column if not exists refund_applied boolean not null default false;

-- Signed adjustment to a seller's payout for one order: the merchandise comes
-- back, so the commission on it comes back too and the platform's take falls
-- with it. Keeps net_payable = gross - commission_amount invariant.
create or replace function private.apply_return_refund_delta(
  p_order_id uuid,
  p_seller_id uuid,
  p_delta numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta numeric(12, 2) := round(coalesce(p_delta, 0), 2);
begin
  if v_delta = 0 then
    return;
  end if;

  update public.seller_payouts as payout
  set gross = greatest(payout.gross - v_delta, 0),
      commission_amount = greatest(
        payout.commission_amount - round(v_delta * payout.commission_rate, 2),
        0
      ),
      net_payable =
        greatest(payout.gross - v_delta, 0)
        - greatest(payout.commission_amount - round(v_delta * payout.commission_rate, 2), 0)
  where payout.order_id = p_order_id
    and payout.seller_id = p_seller_id;
end;
$$;

revoke all on function private.apply_return_refund_delta(uuid, uuid, numeric) from public;

-- ---------------------------------------------------------------------------
-- 7. Return status machine books the refund when it is marked refunded
-- ---------------------------------------------------------------------------

create or replace function public.seller_set_return_status(
  p_return_id uuid,
  p_status text,
  p_seller_note text default '',
  p_refund_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_return public.order_returns%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_note text := btrim(coalesce(p_seller_note, ''));
  v_refund numeric(12, 2);
  v_prev_applied boolean := false;
  v_prev_refund numeric(12, 2) := 0;
  v_notify_type text;
  v_notify_title text;
  v_notify_message text;
begin
  if v_status not in ('approved', 'rejected', 'received', 'refunded', 'closed') then
    raise exception 'Choose a valid return status.';
  end if;

  if char_length(v_note) > 1000 then
    raise exception 'Seller note must be 1000 characters or fewer.';
  end if;

  select *
  into v_return
  from public.order_returns
  where id = p_return_id
    and seller_id = v_seller_id
  for update;

  if v_return.id is null then
    raise exception 'Return not found.';
  end if;

  if v_return.status in ('rejected', 'closed') then
    raise exception 'This return is already closed.';
  end if;

  if not (
    (v_return.status = 'requested' and v_status in ('approved', 'rejected'))
    or (v_return.status = 'approved' and v_status in ('received', 'rejected', 'closed'))
    or (v_return.status = 'received' and v_status in ('refunded', 'closed'))
    or (v_return.status = 'refunded' and v_status = 'closed')
  ) then
    raise exception 'Choose the next valid return status.';
  end if;

  v_refund := coalesce(p_refund_amount, v_return.refund_amount);
  if v_refund < 0 then
    raise exception 'Refund amount cannot be negative.';
  end if;

  if v_status = 'rejected' and char_length(v_note) < 3 then
    raise exception 'Add a short note explaining the rejection.';
  end if;

  -- Remember how much of this refund was already clawed back so corrections
  -- apply only the difference.
  v_prev_applied := v_return.refund_applied;
  v_prev_refund := round(coalesce(v_return.refund_amount, 0), 2);

  update public.order_returns
  set status = v_status,
      seller_note = case when v_note = '' then seller_note else v_note end,
      refund_amount = v_refund,
      resolved_at = case
        when v_status in ('rejected', 'closed', 'refunded') then now()
        else resolved_at
      end,
      resolved_by = case
        when v_status in ('rejected', 'closed', 'refunded') then v_seller_id
        else resolved_by
      end,
      updated_at = now()
  where id = p_return_id
  returning * into v_return;

  -- Book the refund against the seller's payout ledger the moment it is
  -- recorded: the payout (and the commission taken on it) drops by the
  -- refunded amount.
  if v_status = 'refunded' or v_prev_applied then
    perform private.apply_return_refund_delta(
      v_return.order_id,
      v_return.seller_id,
      round(coalesce(v_return.refund_amount, 0), 2)
        - (case when v_prev_applied then v_prev_refund else 0 end)
    );
    update public.order_returns
    set refund_applied = true
    where id = v_return.id;
  end if;

  v_notify_type := 'return_updated';
  v_notify_title := 'Return update';
  v_notify_message := format('Your return is now %s.', replace(v_status, '_', ' '));

  if v_status = 'approved' then
    v_notify_title := 'Return approved';
    v_notify_message := 'The supplier approved your return. Ship the items back if required.';
  elsif v_status = 'rejected' then
    v_notify_title := 'Return rejected';
    v_notify_message := format('The supplier rejected the return. %s', coalesce(nullif(v_note, ''), ''));
  elsif v_status = 'received' then
    v_notify_title := 'Return received';
    v_notify_message := 'The supplier marked the returned items as received.';
  elsif v_status = 'refunded' then
    v_notify_title := 'Return refund recorded';
    v_notify_message := format('A refund of %s was recorded for your return.', v_refund::text);
  elsif v_status = 'closed' then
    v_notify_title := 'Return closed';
    v_notify_message := 'The return was closed by the supplier.';
  end if;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    v_return.retailer_id,
    v_return.order_id,
    v_notify_type,
    v_notify_title,
    v_notify_message
  );

  return jsonb_build_object(
    'id', v_return.id,
    'orderId', v_return.order_id,
    'status', v_return.status,
    'reason', v_return.reason,
    'sellerNote', v_return.seller_note,
    'refundAmount', v_return.refund_amount,
    'requestedAt', v_return.requested_at,
    'resolvedAt', v_return.resolved_at,
    'updatedAt', v_return.updated_at
  );
end;
$$;

revoke execute on function public.seller_set_return_status(uuid, text, text, numeric)
from public, anon;
grant execute on function public.seller_set_return_status(uuid, text, text, numeric)
to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Payout accrual: delivered + fully paid, net of applied return refunds
-- ---------------------------------------------------------------------------

create or replace function public.accrue_seller_payouts_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  placed_order public.orders%rowtype;
  applied_rate numeric(5, 4);
begin
  select *
  into placed_order
  from public.orders
  where id = p_order_id;

  if placed_order.id is null
    or placed_order.status is distinct from 'delivered'
    or placed_order.payment_status is distinct from 'paid'
    or placed_order.delivery_payment_status is distinct from 'paid'
  then
    return;
  end if;

  select commission_rate
  into applied_rate
  from public.platform_settings
  where id = 'default';

  if applied_rate is null then
    applied_rate := 0;
  end if;

  insert into public.seller_payouts (
    seller_id,
    order_id,
    gross,
    commission_rate,
    commission_amount,
    net_payable,
    status
  )
  select
    net.seller_id,
    p_order_id,
    net.net_gross,
    applied_rate,
    round(net.net_gross * applied_rate, 2),
    round(net.net_gross - round(net.net_gross * applied_rate, 2), 2),
    'available'
  from (
    select
      totals.seller_id as seller_id,
      round(totals.gross - coalesce(refunded.refunded_total, 0), 2) as net_gross
    from (
      select
        coalesce(item.seller_id, product.seller_id) as seller_id,
        round(sum(item.quantity * item.unit_price), 2) as gross
      from public.order_items as item
      left join public.products as product on product.id = item.product_id
      where item.order_id = p_order_id
      group by coalesce(item.seller_id, product.seller_id)
    ) as totals
    left join (
      -- Refunds already booked through returned merchandise reduce what this
      -- seller earns on the order when the payout accrues after the refund.
      select ret.seller_id, sum(ret.refund_amount) as refunded_total
      from public.order_returns as ret
      where ret.order_id = p_order_id
        and ret.refund_applied
      group by ret.seller_id
    ) as refunded on refunded.seller_id = totals.seller_id
  ) as net
  where net.seller_id is not null
    and net.net_gross > 0
  on conflict (seller_id, order_id) do nothing;
end;
$$;

revoke execute on function public.accrue_seller_payouts_for_order(uuid)
from public, anon, authenticated;

grant execute on function public.accrue_seller_payouts_for_order(uuid)
to service_role;

-- ---------------------------------------------------------------------------
-- 9. Backfill: historical refunded returns claw back their payouts
-- ---------------------------------------------------------------------------

update public.order_returns
set refund_applied = true
where status = 'refunded'
  and refund_amount > 0;

with historical as (
  select ret.order_id, ret.seller_id, round(ret.refund_amount, 2) as refund_amount
  from public.order_returns as ret
  where ret.status = 'refunded'
    and ret.refund_amount > 0
)
update public.seller_payouts as payout
set gross = greatest(payout.gross - historical.refund_amount, 0),
    commission_amount = greatest(
      payout.commission_amount - round(historical.refund_amount * payout.commission_rate, 2),
      0
    ),
    net_payable =
      greatest(payout.gross - historical.refund_amount, 0)
      - greatest(payout.commission_amount - round(historical.refund_amount * payout.commission_rate, 2), 0)
from historical
where payout.order_id = historical.order_id
  and payout.seller_id = historical.seller_id;
