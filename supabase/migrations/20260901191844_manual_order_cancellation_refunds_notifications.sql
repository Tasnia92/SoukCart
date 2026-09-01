-- Cancellation is approved by an administrator. Refunds are recorded and
-- completed manually; no payment-provider refund is initiated by the database.

alter table public.orders
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_verified_at timestamptz,
  add column if not exists delivery_verified_by uuid references public.users(id),
  add column if not exists cancellation_initiator text,
  add column if not exists cancellation_requested_by uuid references public.users(id),
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.users(id),
  add column if not exists platform_charge numeric(12, 2) not null default 0,
  add column if not exists delivery_charge numeric(12, 2) not null default 0,
  add column if not exists refund_amount numeric(12, 2) not null default 0,
  add column if not exists manual_refund_status text not null default 'not_required',
  add column if not exists refund_completed_at timestamptz,
  add column if not exists refund_completed_by uuid references public.users(id);

alter table public.orders
  add constraint orders_cancellation_initiator_check
    check (cancellation_initiator is null or cancellation_initiator in ('retailer', 'supplier', 'admin', 'support')),
  add constraint orders_platform_charge_check check (platform_charge >= 0),
  add constraint orders_delivery_charge_check check (delivery_charge >= 0),
  add constraint orders_refund_amount_check check (refund_amount >= 0),
  add constraint orders_manual_refund_status_check
    check (manual_refund_status in ('not_required', 'review_required', 'pending', 'completed'));

-- Existing paid online cancellations have no trustworthy refund history. Keep
-- them visible for explicit admin reconciliation instead of claiming that no
-- refund was required.
update public.orders
set manual_refund_status = 'review_required'
where status = 'cancelled'
  and payment_method = 'online'
  and payment_status = 'paid';

alter table public.orders
  add constraint orders_manual_refund_state_check
  check (
    (
      manual_refund_status = 'not_required'
      and refund_amount = 0
      and refund_completed_at is null
      and refund_completed_by is null
      and (
        (
          status = 'cancelled'
          and payment_method = 'online'
          and payment_status = 'paid'
        )
        or (platform_charge = 0 and delivery_charge = 0)
      )
    )
    or (
      manual_refund_status = 'review_required'
      and status = 'cancelled'
      and payment_method = 'online'
      and payment_status = 'paid'
      and refund_amount = 0
      and platform_charge = 0
      and delivery_charge = 0
      and refund_completed_at is null
      and refund_completed_by is null
    )
    or (
      manual_refund_status = 'pending'
      and status = 'cancelled'
      and payment_method = 'online'
      and payment_status = 'paid'
      and refund_amount > 0
      and refund_completed_at is null
      and refund_completed_by is null
    )
    or (
      manual_refund_status = 'completed'
      and status = 'cancelled'
      and payment_method = 'online'
      and payment_status = 'paid'
      and refund_amount > 0
      and refund_completed_at is not null
      and refund_completed_by is not null
    )
  );

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);

create index notifications_order_idx
  on public.notifications (order_id)
  where order_id is not null;

alter table public.notifications enable row level security;
revoke all on table public.notifications from public, anon, authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own
on public.notifications
for select
to authenticated
using ((select auth.uid()) = recipient_id);

drop policy if exists notifications_mark_own_read on public.notifications;
create policy notifications_mark_own_read
on public.notifications
for update
to authenticated
using ((select auth.uid()) = recipient_id)
with check ((select auth.uid()) = recipient_id);

alter table public.complaints
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists category text not null default 'general';

alter table public.complaints
  add constraint complaints_category_check
    check (category in ('general', 'cancellation_refund'));

create index complaints_order_idx
  on public.complaints (order_id)
  where order_id is not null;

drop policy if exists complaints_insert_own on public.complaints;
create policy complaints_insert_own
on public.complaints
for insert
to authenticated
with check (
  retailer_id = (select auth.uid())
  and (
    (category = 'general' and order_id is null)
    or (
      category = 'cancellation_refund'
      and order_id is not null
      and exists (
        select 1
        from public.orders as support_order
        where support_order.id = public.complaints.order_id
          and support_order.retailer_id = (select auth.uid())
          and support_order.status = 'delivered'
          and support_order.delivery_verified_at is not null
      )
    )
  )
);

create or replace function public.notify_admins_of_order_support_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category = 'cancellation_refund' and new.order_id is not null then
    insert into public.notifications (recipient_id, order_id, type, title, message)
    select account.id,
      new.order_id,
      'order_support_requested',
      'Cancellation and refund support requested',
      'A retailer contacted support about verified order #' || upper(substr(new.order_id::text, 1, 8)) || '.'
    from public.users as account
    where account.role = 'admin';
  end if;

  return new;
end;
$$;

revoke execute on function public.notify_admins_of_order_support_request()
from public, anon, authenticated;

drop trigger if exists complaints_notify_order_support on public.complaints;
create trigger complaints_notify_order_support
after insert on public.complaints
for each row
execute function public.notify_admins_of_order_support_request();

drop function public.request_order_cancellation(uuid);

create function public.request_order_cancellation(p_order_id uuid)
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
    select product.seller_id
    from public.order_items as item
    join public.products as product on product.id = item.product_id
    where item.order_id = p_order_id
      and product.seller_id is not null
  ) as recipient;

  return jsonb_build_object(
    'status', 'requested',
    'initiator', 'retailer',
    'refundPolicy', case
      when placed_order.payment_method = 'online' and placed_order.payment_status = 'paid'
        then 'manual_less_charges'
      else 'not_required'
    end
  );
end;
$$;

revoke execute on function public.request_order_cancellation(uuid)
from public, anon;
grant execute on function public.request_order_cancellation(uuid)
to authenticated;

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
  supplier_id uuid := (select auth.uid());
  placed_order public.orders%rowtype;
begin
  if supplier_id is null or not exists (
    select 1
    from public.users as account
    where account.id = supplier_id
      and account.role = 'seller'
  ) then
    raise exception 'A supplier account is required to cancel an order.';
  end if;

  if not exists (
    select 1
    from public.order_items as item
    join public.products as product on product.id = item.product_id
    where item.order_id = p_order_id
      and product.seller_id = supplier_id
  ) then
    raise exception 'This order is not assigned to your supplier account.';
  end if;

  if exists (
    select 1
    from public.order_items as item
    join public.products as product on product.id = item.product_id
    where item.order_id = p_order_id
      and product.seller_id is distinct from supplier_id
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
    select product.seller_id
    from public.order_items as item
    join public.products as product on product.id = item.product_id
    where item.order_id = p_order_id
      and product.seller_id is not null
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

create or replace function public.confirm_order_delivery(p_order_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retailer_id uuid := (select auth.uid());
  verified_at timestamptz;
begin
  if v_retailer_id is null then
    raise exception 'Sign in to verify delivery.';
  end if;

  update public.orders
  set delivery_verified_at = coalesce(delivery_verified_at, now()),
      delivery_verified_by = coalesce(delivery_verified_by, v_retailer_id)
  where id = p_order_id
    and orders.retailer_id = v_retailer_id
    and status = 'delivered'
    and not cancel_requested
  returning delivery_verified_at into verified_at;

  if verified_at is null then
    raise exception 'This order is not available for delivery verification.';
  end if;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  select distinct recipient.id,
    p_order_id,
    'delivery_verified',
    'Delivery verified',
    'The retailer verified delivery of order #' || upper(substr(p_order_id::text, 1, 8)) || '.'
  from (
    select account.id
    from public.users as account
    where account.role = 'admin'
    union
    select product.seller_id
    from public.order_items as item
    join public.products as product on product.id = item.product_id
    where item.order_id = p_order_id
      and product.seller_id is not null
  ) as recipient;

  return verified_at;
end;
$$;

revoke execute on function public.confirm_order_delivery(uuid)
from public, anon;
grant execute on function public.confirm_order_delivery(uuid)
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
  order_total numeric(12, 2);
  refund_due numeric(12, 2) := 0;
  refund_state text := 'not_required';
  resolved_initiator text;
  request_was_pending boolean;
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

  if p_platform_charge < 0 or p_delivery_charge < 0 then
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
      select product.seller_id
      from public.order_items as item
      join public.products as product on product.id = item.product_id
      where item.order_id = p_order_id
        and product.seller_id is not null
    ) as recipient;

    return jsonb_build_object(
      'id', p_order_id,
      'status', placed_order.status,
      'cancelRequested', false,
      'manualRefundStatus', placed_order.manual_refund_status,
      'refundAmount', placed_order.refund_amount
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

  if p_status = 'cancelled' then
    select round(coalesce(sum(item.quantity * item.unit_price), 0), 2)
    into order_total
    from public.order_items as item
    where item.order_id = p_order_id;

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
        refund_due := order_total;
        p_platform_charge := 0;
        p_delivery_charge := 0;
      else
        if p_platform_charge + p_delivery_charge > order_total then
          raise exception 'Cancellation charges cannot exceed the paid order total.';
        end if;
        refund_due := order_total - p_platform_charge - p_delivery_charge;
      end if;
      refund_state := case when refund_due > 0 then 'pending' else 'not_required' end;
    else
      p_platform_charge := 0;
      p_delivery_charge := 0;
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
        platform_charge = p_platform_charge,
        delivery_charge = p_delivery_charge,
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
        when refund_state = 'pending'
          then 'Order #' || upper(substr(p_order_id::text, 1, 8)) || ' was cancelled. A manual refund of ' || to_char(refund_due, 'FM999999990.00') || ' BDT is pending.'
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
    select distinct product.seller_id,
      p_order_id,
      'order_cancelled',
      'Order cancelled',
      'Order #' || upper(substr(p_order_id::text, 1, 8)) || ' was cancelled. The admin team is handling any retailer refund manually.'
    from public.order_items as item
    join public.products as product on product.id = item.product_id
    where item.order_id = p_order_id
      and product.seller_id is not null;
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
    'platformCharge', p_platform_charge,
    'deliveryCharge', p_delivery_charge
  );
end;
$$;

revoke execute on function public.admin_update_order_status(uuid, text, uuid, numeric, numeric)
from public, anon, authenticated;
grant execute on function public.admin_update_order_status(uuid, text, uuid, numeric, numeric)
to service_role;

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

  update public.orders
  set manual_refund_status = 'completed',
      refund_completed_at = now(),
      refund_completed_by = p_admin_id
  where id = p_order_id
    and status = 'cancelled'
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
  select distinct product.seller_id,
    p_order_id,
    'manual_refund_completed',
    'Retailer refund completed',
    'The admin completed the retailer refund for cancelled order #' || upper(substr(p_order_id::text, 1, 8)) || '.'
  from public.order_items as item
  join public.products as product on product.id = item.product_id
  where item.order_id = p_order_id
    and product.seller_id is not null;

  return jsonb_build_object(
    'id', p_order_id,
    'manualRefundStatus', 'completed',
    'refundAmount', completed_order.refund_amount,
    'refundCompletedAt', completed_order.refund_completed_at
  );
end;
$$;

revoke execute on function public.admin_complete_manual_refund(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_complete_manual_refund(uuid, uuid)
to service_role;

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
      placed_order.manual_refund_status,
      not exists (
        select 1
        from public.order_items as other_item
        join public.products as other_product on other_product.id = other_item.product_id
        where other_item.order_id = placed_order.id
          and other_product.seller_id is distinct from (select auth.uid())
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
          'product_name', product.name,
          'quantity', item.quantity,
          'unit_price', item.unit_price,
          'line_total', item.quantity * item.unit_price
        ) order by product.name)
        from public.order_items as item
        join public.products as product on product.id = item.product_id
        where item.order_id = placed_order.id
          and product.seller_id = (select auth.uid())
      ) as items,
      (
        select coalesce(sum(item.quantity * item.unit_price), 0)
        from public.order_items as item
        join public.products as product on product.id = item.product_id
        where item.order_id = placed_order.id
          and product.seller_id = (select auth.uid())
      ) as supplier_total
    from public.orders as placed_order
    join public.users as retailer on retailer.id = placed_order.retailer_id
    left join public.order_supplier_acceptances as acceptance
      on acceptance.order_id = placed_order.id
      and acceptance.supplier_id = (select auth.uid())
    where exists (
      select 1
      from public.users as supplier
      where supplier.id = (select auth.uid())
        and supplier.role = 'seller'
    )
      and exists (
        select 1
        from public.order_items as item
        join public.products as product on product.id = item.product_id
        where item.order_id = placed_order.id
          and product.seller_id = (select auth.uid())
      )
    order by placed_order.created_at desc
  ) as visible_order;
$$;

revoke execute on function public.supplier_orders() from public, anon;
grant execute on function public.supplier_orders() to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
