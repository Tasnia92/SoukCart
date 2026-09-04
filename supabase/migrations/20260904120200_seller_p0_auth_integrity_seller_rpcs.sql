-- ---------------------------------------------------------------------------
-- Seller RPCs: approved gate + snapshot-based ownership
-- ---------------------------------------------------------------------------

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
  if p_status not in ('confirmed', 'shipped', 'delivered') then
    raise exception 'Choose a valid fulfillment status.';
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

  if not (
    (placed_order.status = 'pending' and p_status = 'confirmed')
    or (placed_order.status = 'confirmed' and p_status = 'shipped')
    or (placed_order.status = 'shipped' and p_status = 'delivered')
  ) then
    raise exception 'Choose the next valid order status.';
  end if;

  update public.orders
  set status = p_status,
      delivered_at = case when p_status = 'delivered' then now() else delivered_at end
  where id = p_order_id;

  return p_status;
end;
$$;

revoke execute on function public.seller_set_order_status(uuid, text)
from public, anon;

grant execute on function public.seller_set_order_status(uuid, text)
to authenticated;

create or replace function public.seller_accept_order(p_order_id uuid)
returns timestamp with time zone
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid := private.require_approved_seller();
  order_status text;
  cancellation_pending boolean;
  accepted timestamptz;
begin
  select placed_order.status, placed_order.cancel_requested
  into order_status, cancellation_pending
  from public.orders as placed_order
  where placed_order.id = p_order_id
  for update;

  if order_status is null
    or order_status <> 'pending'
    or cancellation_pending
    or not exists (
      select 1
      from public.order_items as item
      where item.order_id = p_order_id
        and item.seller_id = v_supplier_id
    )
  then
    raise exception 'This order is not available for acceptance.';
  end if;

  insert into public.order_supplier_acceptances (order_id, supplier_id)
  values (p_order_id, v_supplier_id)
  on conflict (order_id, supplier_id) do update
    set accepted_at = public.order_supplier_acceptances.accepted_at
  returning accepted_at into accepted;

  return accepted;
end;
$$;

revoke execute on function public.seller_accept_order(uuid) from public, anon;
grant execute on function public.seller_accept_order(uuid) to authenticated;

create or replace function public.seller_earnings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  current_rate numeric(5, 4);
begin
  select commission_rate
  into current_rate
  from public.platform_settings
  where id = 'default';

  return jsonb_build_object(
    'commissionRate', coalesce(current_rate, 0),
    'available', (
      select coalesce(sum(payout.net_payable), 0)
      from public.seller_payouts as payout
      where payout.seller_id = v_seller_id and payout.status = 'available'
    ),
    'paid', (
      select coalesce(sum(payout.net_payable), 0)
      from public.seller_payouts as payout
      where payout.seller_id = v_seller_id and payout.status = 'paid'
    ),
    'commission', (
      select coalesce(sum(payout.commission_amount), 0)
      from public.seller_payouts as payout
      where payout.seller_id = v_seller_id and payout.status in ('available', 'paid')
    ),
    'rows', coalesce((
      select jsonb_agg(row_data order by accrued_at desc)
      from (
        select jsonb_build_object(
          'id', payout.id,
          'orderId', payout.order_id,
          'gross', payout.gross,
          'commissionRate', payout.commission_rate,
          'commissionAmount', payout.commission_amount,
          'netPayable', payout.net_payable,
          'status', payout.status,
          'accruedAt', payout.accrued_at,
          'paidAt', payout.paid_at
        ) as row_data,
        payout.accrued_at
        from public.seller_payouts as payout
        where payout.seller_id = v_seller_id
        order by payout.accrued_at desc
        limit 40
      ) as payout_rows
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.seller_earnings() from public, anon;
grant execute on function public.seller_earnings() to authenticated;

create or replace function public.seller_request_order_cancellation(
  p_order_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplier_id uuid := private.require_approved_seller();
  placed_order public.orders%rowtype;
begin
  if not exists (
    select 1
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id = supplier_id
  ) then
    raise exception 'This order is not assigned to your supplier account.';
  end if;

  if exists (
    select 1
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id is distinct from supplier_id
  ) then
    raise exception 'A supplier cannot cancel a multi-supplier order. Contact the admin team to resolve only your fulfillment.';
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

  if placed_order.status = 'delivered'
    and placed_order.delivery_verified_at is not null
  then
    raise exception 'A verified delivery can no longer be cancelled by a supplier.';
  end if;

  if placed_order.cancel_requested then
    raise exception 'A cancellation request is already pending.';
  end if;

  update public.orders
  set cancel_requested = true,
      cancel_requested_at = now(),
      cancellation_initiator = 'supplier',
      cancellation_requested_by = supplier_id,
      cancellation_reason = coalesce(nullif(btrim(p_reason), ''), 'Supplier requested cancellation')
  where id = p_order_id;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select distinct recipient.id,
    p_order_id,
    'supplier_cancellation_requested',
    'Supplier cancellation requested',
    'A supplier requested cancellation of order #' || upper(substr(p_order_id::text, 1, 8)) || '. A paid online order requires a full manual refund.'
  from (
    select account.id
    from public.users as account
    where account.role = 'admin'
    union
    select placed_order.retailer_id
    union
    select item.seller_id
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id is not null
  ) as recipient
  where recipient.id <> supplier_id;

  return jsonb_build_object(
    'status', 'requested',
    'initiator', 'supplier',
    'refundPolicy', case
      when placed_order.payment_method = 'online' and placed_order.payment_status = 'paid'
        then 'manual_full'
      else 'not_required'
    end
  );
end;
$$;

revoke execute on function public.seller_request_order_cancellation(uuid, text)
from public, anon;

grant execute on function public.seller_request_order_cancellation(uuid, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- 4. COD collection: no pending; multi-supplier guard; approved sellers
-- ---------------------------------------------------------------------------

create or replace function public.collect_cod_payment(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  collected public.orders%rowtype;
begin
  if actor_id is null then
    raise exception 'Sign in to record a cash payment.';
  end if;

  select account.role
  into actor_role
  from public.users as account
  where account.id = actor_id;

  if actor_role is distinct from 'admin' and actor_role is distinct from 'seller' then
    raise exception 'Only a supplier or administrator can record cash collection.';
  end if;

  if actor_role = 'seller' then
    if not private.is_approved_supplier(actor_id) then
      raise exception 'Your shop must be verified before you can manage supplier operations.';
    end if;

    if not exists (
      select 1
      from public.order_items as item
      where item.order_id = p_order_id
        and item.seller_id = actor_id
    ) then
      raise exception 'This order is not assigned to your supplier account.';
    end if;

    if exists (
      select 1
      from public.order_items as item
      where item.order_id = p_order_id
        and item.seller_id is distinct from actor_id
    ) then
      raise exception 'A supplier cannot collect cash for a multi-supplier order. Contact the admin team.';
    end if;
  end if;

  update public.orders
  set payment_status = 'paid',
      paid_at = coalesce(paid_at, now())
  where id = p_order_id
    and payment_method = 'cod'
    and payment_status = 'unpaid'
    and status not in ('pending', 'cancelled')
  returning * into collected;

  if collected.id is null then
    raise exception 'This order is not waiting for cash collection.';
  end if;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    collected.retailer_id,
    collected.id,
    'cod_collected',
    'Cash on delivery collected',
    'Cash was collected for order #' || upper(substr(collected.id::text, 1, 8)) || '. Your invoice is ready.'
  );

  return jsonb_build_object(
    'id', collected.id,
    'paymentStatus', 'paid',
    'paidAt', collected.paid_at
  );
end;
$$;

revoke execute on function public.collect_cod_payment(uuid) from public, anon;
grant execute on function public.collect_cod_payment(uuid) to authenticated;

-- Accrue payouts from snapshotted seller_id (fallback to live product).
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
    or placed_order.status = 'cancelled'
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
    coalesce(item.seller_id, product.seller_id),
    p_order_id,
    round(sum(item.quantity * item.unit_price), 2),
    applied_rate,
    round(round(sum(item.quantity * item.unit_price), 2) * applied_rate, 2),
    round(
      round(sum(item.quantity * item.unit_price), 2)
      - round(round(sum(item.quantity * item.unit_price), 2) * applied_rate, 2),
      2
    ),
    'available'
  from public.order_items as item
  left join public.products as product on product.id = item.product_id
  where item.order_id = p_order_id
    and coalesce(item.seller_id, product.seller_id) is not null
  group by coalesce(item.seller_id, product.seller_id)
  having round(sum(item.quantity * item.unit_price), 2) > 0
  on conflict (seller_id, order_id) do nothing;
end;
$$;

revoke execute on function public.accrue_seller_payouts_for_order(uuid)
from public, anon, authenticated;

grant execute on function public.accrue_seller_payouts_for_order(uuid)
to service_role;
