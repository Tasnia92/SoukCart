-- P3: Per-seller shipment tracking (carrier, tracking number, events).
-- Shipping moves confirmed → shipped only through seller_ship_order so every
-- in-transit order carries tracking metadata.

create table if not exists public.order_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  seller_id uuid not null references public.users (id),
  carrier text not null,
  tracking_number text not null,
  tracking_url text not null default '',
  status text not null default 'shipped',
  notes text not null default '',
  shipped_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_shipments_carrier_length
    check (char_length(btrim(carrier)) between 2 and 80),
  constraint order_shipments_tracking_number_length
    check (char_length(btrim(tracking_number)) between 3 and 80),
  constraint order_shipments_tracking_url_length
    check (char_length(tracking_url) <= 500),
  constraint order_shipments_notes_length
    check (char_length(notes) <= 1000),
  constraint order_shipments_status_allowed
    check (status in (
      'shipped',
      'in_transit',
      'out_for_delivery',
      'delivered',
      'exception'
    )),
  constraint order_shipments_order_seller_unique unique (order_id, seller_id)
);

create index if not exists order_shipments_seller_id_idx
  on public.order_shipments (seller_id, shipped_at desc);

create index if not exists order_shipments_order_id_idx
  on public.order_shipments (order_id);

create table if not exists public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.order_shipments (id) on delete cascade,
  event_type text not null,
  message text not null,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  constraint shipment_events_event_type_allowed
    check (event_type in (
      'created',
      'in_transit',
      'out_for_delivery',
      'delivered',
      'exception',
      'note'
    )),
  constraint shipment_events_message_length
    check (char_length(btrim(message)) between 1 and 500)
);

create index if not exists shipment_events_shipment_id_idx
  on public.shipment_events (shipment_id, occurred_at desc);

alter table public.order_shipments enable row level security;
alter table public.shipment_events enable row level security;

grant select on table public.order_shipments to authenticated;
grant select on table public.shipment_events to authenticated;

drop policy if exists order_shipments_read_as_supplier on public.order_shipments;
create policy order_shipments_read_as_supplier
  on public.order_shipments
  for select
  to authenticated
  using (
    seller_id = (select auth.uid())
    and private.is_approved_supplier((select auth.uid()))
  );

drop policy if exists order_shipments_read_as_retailer on public.order_shipments;
create policy order_shipments_read_as_retailer
  on public.order_shipments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders as placed_order
      where placed_order.id = order_shipments.order_id
        and placed_order.retailer_id = (select auth.uid())
    )
  );

drop policy if exists shipment_events_read_as_supplier on public.shipment_events;
create policy shipment_events_read_as_supplier
  on public.shipment_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.order_shipments as shipment
      where shipment.id = shipment_events.shipment_id
        and shipment.seller_id = (select auth.uid())
        and private.is_approved_supplier((select auth.uid()))
    )
  );

drop policy if exists shipment_events_read_as_retailer on public.shipment_events;
create policy shipment_events_read_as_retailer
  on public.shipment_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.order_shipments as shipment
      join public.orders as placed_order on placed_order.id = shipment.order_id
      where shipment.id = shipment_events.shipment_id
        and placed_order.retailer_id = (select auth.uid())
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_shipments'
  ) then
    alter publication supabase_realtime add table public.order_shipments;
  end if;
end;
$$;

-- Ship with required tracking. Replaces bare status=shipped for sellers.
create or replace function public.seller_ship_order(
  p_order_id uuid,
  p_carrier text,
  p_tracking_number text,
  p_tracking_url text default '',
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid := private.require_approved_seller();
  placed_order public.orders%rowtype;
  v_carrier text := btrim(coalesce(p_carrier, ''));
  v_tracking_number text := btrim(coalesce(p_tracking_number, ''));
  v_tracking_url text := btrim(coalesce(p_tracking_url, ''));
  v_notes text := btrim(coalesce(p_notes, ''));
  v_shipment public.order_shipments%rowtype;
begin
  if char_length(v_carrier) < 2 or char_length(v_carrier) > 80 then
    raise exception 'Enter a carrier name (2–80 characters).';
  end if;

  if char_length(v_tracking_number) < 3 or char_length(v_tracking_number) > 80 then
    raise exception 'Enter a tracking number (3–80 characters).';
  end if;

  if char_length(v_tracking_url) > 500 then
    raise exception 'Tracking URL must be 500 characters or fewer.';
  end if;

  if v_tracking_url <> '' and v_tracking_url !~* '^https?://' then
    raise exception 'Tracking URL must start with http:// or https://.';
  end if;

  if char_length(v_notes) > 1000 then
    raise exception 'Shipment notes must be 1000 characters or fewer.';
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

  if placed_order.status is distinct from 'confirmed' then
    raise exception 'Only confirmed orders can be marked shipped.';
  end if;

  if placed_order.payment_method is distinct from 'cod'
    and placed_order.payment_status is distinct from 'paid'
  then
    raise exception 'Wait for payment before shipping this order.';
  end if;

  if exists (
    select 1
    from public.order_shipments as shipment
    where shipment.order_id = p_order_id
      and shipment.seller_id = v_supplier_id
  ) then
    raise exception 'A shipment already exists for this order.';
  end if;

  update public.orders
  set status = 'shipped'
  where id = p_order_id;

  insert into public.order_shipments (
    order_id,
    seller_id,
    carrier,
    tracking_number,
    tracking_url,
    status,
    notes
  )
  values (
    p_order_id,
    v_supplier_id,
    v_carrier,
    v_tracking_number,
    v_tracking_url,
    'shipped',
    v_notes
  )
  returning * into v_shipment;

  insert into public.shipment_events (
    shipment_id,
    event_type,
    message,
    created_by
  )
  values (
    v_shipment.id,
    'created',
    format('Shipped via %s · tracking %s', v_carrier, v_tracking_number),
    v_supplier_id
  );

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    placed_order.retailer_id,
    p_order_id,
    'order_shipped',
    'Your order was shipped',
    format(
      'Order shipped via %s. Tracking number: %s.',
      v_carrier,
      v_tracking_number
    )
  );

  return jsonb_build_object(
    'status', 'shipped',
    'shipmentId', v_shipment.id,
    'carrier', v_shipment.carrier,
    'trackingNumber', v_shipment.tracking_number,
    'trackingUrl', v_shipment.tracking_url,
    'shipmentStatus', v_shipment.status,
    'shippedAt', v_shipment.shipped_at
  );
end;
$$;

revoke execute on function public.seller_ship_order(uuid, text, text, text, text)
from public, anon;
grant execute on function public.seller_ship_order(uuid, text, text, text, text)
to authenticated;

-- Update tracking details after ship (does not change order status).
create or replace function public.seller_update_shipment(
  p_order_id uuid,
  p_carrier text default null,
  p_tracking_number text default null,
  p_tracking_url text default null,
  p_status text default null,
  p_notes text default null,
  p_event_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid := private.require_approved_seller();
  v_shipment public.order_shipments%rowtype;
  v_carrier text;
  v_tracking_number text;
  v_tracking_url text;
  v_status text;
  v_notes text;
  v_event_message text := btrim(coalesce(p_event_message, ''));
  v_event_type text := 'note';
begin
  select *
  into v_shipment
  from public.order_shipments
  where order_id = p_order_id
    and seller_id = v_supplier_id
  for update;

  if v_shipment.id is null then
    raise exception 'No shipment found for this order.';
  end if;

  v_carrier := coalesce(nullif(btrim(coalesce(p_carrier, '')), ''), v_shipment.carrier);
  v_tracking_number := coalesce(
    nullif(btrim(coalesce(p_tracking_number, '')), ''),
    v_shipment.tracking_number
  );
  v_tracking_url := case
    when p_tracking_url is null then v_shipment.tracking_url
    else btrim(p_tracking_url)
  end;
  v_status := coalesce(nullif(btrim(coalesce(p_status, '')), ''), v_shipment.status);
  v_notes := case
    when p_notes is null then v_shipment.notes
    else btrim(p_notes)
  end;

  if char_length(v_carrier) < 2 or char_length(v_carrier) > 80 then
    raise exception 'Enter a carrier name (2–80 characters).';
  end if;

  if char_length(v_tracking_number) < 3 or char_length(v_tracking_number) > 80 then
    raise exception 'Enter a tracking number (3–80 characters).';
  end if;

  if char_length(v_tracking_url) > 500 then
    raise exception 'Tracking URL must be 500 characters or fewer.';
  end if;

  if v_tracking_url <> '' and v_tracking_url !~* '^https?://' then
    raise exception 'Tracking URL must start with http:// or https://.';
  end if;

  if v_status not in ('shipped', 'in_transit', 'out_for_delivery', 'delivered', 'exception') then
    raise exception 'Choose a valid shipment status.';
  end if;

  if char_length(v_notes) > 1000 then
    raise exception 'Shipment notes must be 1000 characters or fewer.';
  end if;

  update public.order_shipments
  set carrier = v_carrier,
      tracking_number = v_tracking_number,
      tracking_url = v_tracking_url,
      status = v_status,
      notes = v_notes,
      updated_at = now()
  where id = v_shipment.id
  returning * into v_shipment;

  if v_status in ('in_transit', 'out_for_delivery', 'delivered', 'exception') then
    v_event_type := v_status;
  end if;

  if v_event_message = '' then
    v_event_message := case v_status
      when 'in_transit' then 'Shipment is in transit'
      when 'out_for_delivery' then 'Shipment is out for delivery'
      when 'delivered' then 'Shipment marked delivered by carrier update'
      when 'exception' then 'Shipment exception recorded'
      else format('Tracking updated · %s / %s', v_carrier, v_tracking_number)
    end;
  end if;

  insert into public.shipment_events (
    shipment_id,
    event_type,
    message,
    created_by
  )
  values (
    v_shipment.id,
    v_event_type,
    v_event_message,
    v_supplier_id
  );

  return jsonb_build_object(
    'shipmentId', v_shipment.id,
    'carrier', v_shipment.carrier,
    'trackingNumber', v_shipment.tracking_number,
    'trackingUrl', v_shipment.tracking_url,
    'shipmentStatus', v_shipment.status,
    'notes', v_shipment.notes,
    'shippedAt', v_shipment.shipped_at,
    'updatedAt', v_shipment.updated_at
  );
end;
$$;

revoke execute on function public.seller_update_shipment(uuid, text, text, text, text, text, text)
from public, anon;
grant execute on function public.seller_update_shipment(uuid, text, text, text, text, text, text)
to authenticated;

-- seller_set_order_status: keep confirmed/delivered; block bare shipped.
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
  if p_status = 'shipped' then
    raise exception 'Use ship with carrier and tracking number to mark an order shipped.';
  end if;

  if p_status not in ('confirmed', 'delivered') then
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
    or (placed_order.status = 'shipped' and p_status = 'delivered')
  ) then
    raise exception 'Choose the next valid order status.';
  end if;

  if p_status = 'confirmed'
    and placed_order.payment_method is distinct from 'cod'
    and placed_order.payment_status is distinct from 'paid'
  then
    raise exception 'Wait for payment before confirming this order.';
  end if;

  if p_status = 'delivered'
    and placed_order.payment_method is distinct from 'cod'
    and placed_order.payment_status is distinct from 'paid'
  then
    raise exception 'Wait for payment before marking this order delivered.';
  end if;

  update public.orders
  set status = p_status,
      delivered_at = case when p_status = 'delivered' then now() else delivered_at end
  where id = p_order_id;

  if p_status = 'delivered' then
    update public.order_shipments
    set status = 'delivered',
        updated_at = now()
    where order_id = p_order_id
      and seller_id = v_supplier_id
      and status is distinct from 'delivered';

    insert into public.shipment_events (shipment_id, event_type, message, created_by)
    select shipment.id, 'delivered', 'Marked delivered by supplier', v_supplier_id
    from public.order_shipments as shipment
    where shipment.order_id = p_order_id
      and shipment.seller_id = v_supplier_id;
  end if;

  return p_status;
end;
$$;

revoke execute on function public.seller_set_order_status(uuid, text)
from public, anon;
grant execute on function public.seller_set_order_status(uuid, text)
to authenticated;

-- Include shipment payload on supplier order rows.
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
      ) as supplier_total,
      (
        select json_build_object(
          'id', shipment.id,
          'carrier', shipment.carrier,
          'tracking_number', shipment.tracking_number,
          'tracking_url', shipment.tracking_url,
          'status', shipment.status,
          'notes', shipment.notes,
          'shipped_at', shipment.shipped_at,
          'updated_at', shipment.updated_at,
          'events', (
            select coalesce(json_agg(json_build_object(
              'id', event.id,
              'event_type', event.event_type,
              'message', event.message,
              'occurred_at', event.occurred_at
            ) order by event.occurred_at desc, event.created_at desc), '[]'::json)
            from public.shipment_events as event
            where event.shipment_id = shipment.id
          )
        )
        from public.order_shipments as shipment
        where shipment.order_id = placed_order.id
          and shipment.seller_id = (select auth.uid())
      ) as shipment
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
