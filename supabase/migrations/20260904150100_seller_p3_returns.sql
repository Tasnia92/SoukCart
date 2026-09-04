-- P3: Seller returns workflow for delivered orders.
-- Retailers or sellers can open a return; sellers advance status through
-- approve / reject / received / refunded / closed.

create table if not exists public.order_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  seller_id uuid not null references public.users (id),
  retailer_id uuid not null references public.users (id),
  status text not null default 'requested',
  reason text not null,
  seller_note text not null default '',
  refund_amount numeric(12, 2) not null default 0,
  requested_by uuid not null references public.users (id),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_returns_status_allowed
    check (status in (
      'requested',
      'approved',
      'rejected',
      'received',
      'refunded',
      'closed'
    )),
  constraint order_returns_reason_length
    check (char_length(btrim(reason)) between 3 and 1000),
  constraint order_returns_seller_note_length
    check (char_length(seller_note) <= 1000),
  constraint order_returns_refund_amount_nonneg
    check (refund_amount >= 0)
);

create unique index if not exists order_returns_one_open_per_seller
  on public.order_returns (order_id, seller_id)
  where status in ('requested', 'approved', 'received', 'refunded');

create index if not exists order_returns_seller_status_idx
  on public.order_returns (seller_id, status, requested_at desc);

create index if not exists order_returns_retailer_id_idx
  on public.order_returns (retailer_id, requested_at desc);

alter table public.order_returns enable row level security;

grant select on table public.order_returns to authenticated;

drop policy if exists order_returns_read_as_supplier on public.order_returns;
create policy order_returns_read_as_supplier
  on public.order_returns
  for select
  to authenticated
  using (
    seller_id = (select auth.uid())
    and private.is_approved_supplier((select auth.uid()))
  );

drop policy if exists order_returns_read_as_retailer on public.order_returns;
create policy order_returns_read_as_retailer
  on public.order_returns
  for select
  to authenticated
  using (retailer_id = (select auth.uid()));

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_returns'
  ) then
    alter publication supabase_realtime add table public.order_returns;
  end if;
end;
$$;

create or replace function private.assert_seller_owns_order_items(
  p_order_id uuid,
  p_seller_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id = p_seller_id
  ) then
    raise exception 'This order is not assigned to your supplier account.';
  end if;
end;
$$;

create or replace function public.seller_request_return(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  placed_order public.orders%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_return public.order_returns%rowtype;
  v_supplier_total numeric(12, 2);
begin
  if char_length(v_reason) < 3 or char_length(v_reason) > 1000 then
    raise exception 'Enter a return reason (3–1000 characters).';
  end if;

  perform private.assert_seller_owns_order_items(p_order_id, v_seller_id);

  select *
  into placed_order
  from public.orders
  where id = p_order_id
  for update;

  if placed_order.id is null then
    raise exception 'Order not found.';
  end if;

  if placed_order.status is distinct from 'delivered' then
    raise exception 'Returns can only be opened for delivered orders.';
  end if;

  if placed_order.cancel_requested or placed_order.status = 'cancelled' then
    raise exception 'This order cannot accept a return right now.';
  end if;

  if exists (
    select 1
    from public.order_returns as existing
    where existing.order_id = p_order_id
      and existing.seller_id = v_seller_id
      and existing.status in ('requested', 'approved', 'received', 'refunded')
  ) then
    raise exception 'An open return already exists for this order.';
  end if;

  select coalesce(sum(item.quantity * item.unit_price), 0)
  into v_supplier_total
  from public.order_items as item
  where item.order_id = p_order_id
    and item.seller_id = v_seller_id;

  insert into public.order_returns (
    order_id,
    seller_id,
    retailer_id,
    status,
    reason,
    refund_amount,
    requested_by
  )
  values (
    p_order_id,
    v_seller_id,
    placed_order.retailer_id,
    'requested',
    v_reason,
    v_supplier_total,
    v_seller_id
  )
  returning * into v_return;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    placed_order.retailer_id,
    p_order_id,
    'return_requested',
    'Return opened for your order',
    format('A return was opened for order items from this supplier. Reason: %s', v_reason)
  );

  return jsonb_build_object(
    'id', v_return.id,
    'orderId', v_return.order_id,
    'status', v_return.status,
    'reason', v_return.reason,
    'refundAmount', v_return.refund_amount,
    'requestedAt', v_return.requested_at
  );
end;
$$;

revoke execute on function public.seller_request_return(uuid, text) from public, anon;
grant execute on function public.seller_request_return(uuid, text) to authenticated;

-- Retailer requests a return against a specific seller on a delivered order.
create or replace function public.request_order_return(
  p_order_id uuid,
  p_seller_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retailer_id uuid := (select auth.uid());
  placed_order public.orders%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_return public.order_returns%rowtype;
  v_supplier_total numeric(12, 2);
begin
  if v_retailer_id is null then
    raise exception 'Sign in to request a return.';
  end if;

  if char_length(v_reason) < 3 or char_length(v_reason) > 1000 then
    raise exception 'Enter a return reason (3–1000 characters).';
  end if;

  if p_seller_id is null then
    raise exception 'Choose which supplier the return applies to.';
  end if;

  select *
  into placed_order
  from public.orders
  where id = p_order_id
  for update;

  if placed_order.id is null then
    raise exception 'Order not found.';
  end if;

  if placed_order.retailer_id is distinct from v_retailer_id then
    raise exception 'You can only request returns on your own orders.';
  end if;

  if placed_order.status is distinct from 'delivered' then
    raise exception 'Returns can only be opened for delivered orders.';
  end if;

  if not exists (
    select 1
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id = p_seller_id
  ) then
    raise exception 'That supplier is not part of this order.';
  end if;

  if exists (
    select 1
    from public.order_returns as existing
    where existing.order_id = p_order_id
      and existing.seller_id = p_seller_id
      and existing.status in ('requested', 'approved', 'received', 'refunded')
  ) then
    raise exception 'An open return already exists for this supplier on the order.';
  end if;

  select coalesce(sum(item.quantity * item.unit_price), 0)
  into v_supplier_total
  from public.order_items as item
  where item.order_id = p_order_id
    and item.seller_id = p_seller_id;

  insert into public.order_returns (
    order_id,
    seller_id,
    retailer_id,
    status,
    reason,
    refund_amount,
    requested_by
  )
  values (
    p_order_id,
    p_seller_id,
    v_retailer_id,
    'requested',
    v_reason,
    v_supplier_total,
    v_retailer_id
  )
  returning * into v_return;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    p_seller_id,
    p_order_id,
    'return_requested',
    'Return requested',
    format('A retailer requested a return. Reason: %s', v_reason)
  );

  return jsonb_build_object(
    'id', v_return.id,
    'orderId', v_return.order_id,
    'status', v_return.status,
    'reason', v_return.reason,
    'refundAmount', v_return.refund_amount,
    'requestedAt', v_return.requested_at
  );
end;
$$;

revoke execute on function public.request_order_return(uuid, uuid, text) from public, anon;
grant execute on function public.request_order_return(uuid, uuid, text) to authenticated;

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

create or replace function public.seller_returns()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(json_agg(row_to_json(visible_return) order by visible_return.requested_at desc), '[]'::json)
  from (
    select
      ret.id,
      ret.order_id,
      ret.status,
      ret.reason,
      ret.seller_note,
      ret.refund_amount,
      ret.requested_at,
      ret.resolved_at,
      ret.updated_at,
      ret.requested_by,
      retailer.name as retailer_name,
      retailer.email as retailer_email,
      (
        select coalesce(sum(item.quantity * item.unit_price), 0)
        from public.order_items as item
        where item.order_id = ret.order_id
          and item.seller_id = ret.seller_id
      ) as supplier_total,
      (
        select json_agg(json_build_object(
          'id', item.id,
          'product_name', item.product_name,
          'quantity', item.quantity,
          'unit_price', item.unit_price,
          'line_total', item.quantity * item.unit_price
        ) order by item.product_name)
        from public.order_items as item
        where item.order_id = ret.order_id
          and item.seller_id = ret.seller_id
      ) as items
    from public.order_returns as ret
    join public.users as retailer on retailer.id = ret.retailer_id
    where ret.seller_id = (select auth.uid())
      and private.is_approved_supplier((select auth.uid()))
  ) as visible_return;
$$;

revoke execute on function public.seller_returns() from public, anon;
grant execute on function public.seller_returns() to authenticated;

-- Extend nav badges with open return count.
create or replace function public.seller_nav_badges()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_needs_action integer := 0;
  v_stock_at_risk integer := 0;
  v_unread_notifications integer := 0;
  v_open_returns integer := 0;
begin
  select count(*)::integer
  into v_needs_action
  from public.orders as placed_order
  where exists (
      select 1
      from public.order_items as item
      where item.order_id = placed_order.id
        and item.seller_id = v_seller_id
    )
    and (
      (
        placed_order.cancel_requested
        and placed_order.status is distinct from 'cancelled'
      )
      or (
        not coalesce(placed_order.cancel_requested, false)
        and (
          (
            placed_order.status = 'pending'
            and (
              placed_order.payment_method = 'cod'
              or placed_order.payment_status = 'paid'
            )
          )
          or (
            placed_order.status = 'confirmed'
            and (
              placed_order.payment_method = 'cod'
              or placed_order.payment_status = 'paid'
            )
          )
          or (
            placed_order.status = 'shipped'
            and (
              placed_order.payment_method = 'cod'
              or placed_order.payment_status = 'paid'
            )
          )
          or (
            placed_order.payment_method = 'cod'
            and placed_order.payment_status = 'unpaid'
            and placed_order.status is distinct from 'cancelled'
            and placed_order.status is distinct from 'pending'
          )
        )
      )
    );

  select count(*)::integer
  into v_stock_at_risk
  from public.products as product
  where product.seller_id = v_seller_id
    and product.is_active
    and product.stock <= product.reorder_threshold;

  select count(*)::integer
  into v_unread_notifications
  from public.notifications as note
  where note.recipient_id = v_seller_id
    and note.read_at is null;

  select count(*)::integer
  into v_open_returns
  from public.order_returns as ret
  where ret.seller_id = v_seller_id
    and ret.status in ('requested', 'approved', 'received', 'refunded');

  return jsonb_build_object(
    'needsAction', coalesce(v_needs_action, 0),
    'stockAtRisk', coalesce(v_stock_at_risk, 0),
    'unreadNotifications', coalesce(v_unread_notifications, 0),
    'openReturns', coalesce(v_open_returns, 0)
  );
end;
$$;

revoke execute on function public.seller_nav_badges() from public, anon;
grant execute on function public.seller_nav_badges() to authenticated;
