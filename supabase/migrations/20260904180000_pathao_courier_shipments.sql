-- Pathao courier: consignments sync into order_shipments; COD settlement to platform.

alter table public.order_shipments
  add column if not exists provider text not null default 'manual',
  add column if not exists consignment_id text,
  add column if not exists pathao_status text,
  add column if not exists pathao_delivery_fee numeric(12, 2),
  add column if not exists collected_amount numeric(12, 2) not null default 0;

alter table public.order_shipments
  drop constraint if exists order_shipments_provider_check;

alter table public.order_shipments
  add constraint order_shipments_provider_check
    check (provider in ('manual', 'pathao'));

alter table public.order_shipments
  drop constraint if exists order_shipments_pathao_delivery_fee_check;

alter table public.order_shipments
  add constraint order_shipments_pathao_delivery_fee_check
    check (pathao_delivery_fee is null or pathao_delivery_fee >= 0);

alter table public.order_shipments
  drop constraint if exists order_shipments_collected_amount_check;

alter table public.order_shipments
  add constraint order_shipments_collected_amount_check
    check (collected_amount >= 0);

create unique index if not exists order_shipments_consignment_id_uidx
  on public.order_shipments (consignment_id)
  where consignment_id is not null;

create table if not exists private.pathao_oauth_tokens (
  id integer primary key default 1 check (id = 1),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

revoke all on table private.pathao_oauth_tokens from public, anon, authenticated;
grant all on table private.pathao_oauth_tokens to service_role;

create or replace function public.service_upsert_pathao_token(
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.pathao_oauth_tokens (id, access_token, refresh_token, expires_at, updated_at)
  values (1, p_access_token, p_refresh_token, p_expires_at, now())
  on conflict (id) do update
    set access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        updated_at = now();
end;
$$;

revoke execute on function public.service_upsert_pathao_token(text, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.service_upsert_pathao_token(text, text, timestamptz)
to service_role;

create or replace function public.service_get_pathao_token()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when token.id is null then null
    else jsonb_build_object(
      'accessToken', token.access_token,
      'refreshToken', token.refresh_token,
      'expiresAt', token.expires_at
    )
  end
  from private.pathao_oauth_tokens as token
  where token.id = 1;
$$;

revoke execute on function public.service_get_pathao_token()
from public, anon, authenticated;
grant execute on function public.service_get_pathao_token()
to service_role;

-- Record a Pathao consignment after the courier API accepts the booking.
create or replace function public.service_create_pathao_shipment(
  p_order_id uuid,
  p_seller_id uuid,
  p_consignment_id text,
  p_pathao_status text default 'Pending',
  p_pathao_delivery_fee numeric default null,
  p_tracking_url text default '',
  p_notes text default '',
  p_amount_to_collect numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  placed_order public.orders%rowtype;
  v_consignment text := btrim(coalesce(p_consignment_id, ''));
  v_tracking_url text := btrim(coalesce(p_tracking_url, ''));
  v_notes text := btrim(coalesce(p_notes, ''));
  v_shipment public.order_shipments%rowtype;
begin
  if char_length(v_consignment) < 3 or char_length(v_consignment) > 80 then
    raise exception 'Pathao consignment id is invalid.';
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
    from public.users as account
    where account.id = p_seller_id
      and account.role = 'seller'
  ) then
    raise exception 'A supplier account is required.';
  end if;

  if not exists (
    select 1
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id = p_seller_id
  ) then
    raise exception 'This order is not assigned to that supplier.';
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

  if placed_order.delivery_payment_status is distinct from 'paid' then
    raise exception 'Wait for the retailer to pay the delivery charge before shipping this order.';
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
    notes,
    provider,
    consignment_id,
    pathao_status,
    pathao_delivery_fee,
    collected_amount
  )
  values (
    p_order_id,
    p_seller_id,
    'Pathao',
    v_consignment,
    v_tracking_url,
    'shipped',
    v_notes,
    'pathao',
    v_consignment,
    nullif(btrim(coalesce(p_pathao_status, '')), ''),
    p_pathao_delivery_fee,
    greatest(coalesce(p_amount_to_collect, 0), 0)
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
    format(
      'Booked with Pathao · consignment %s%s',
      v_consignment,
      case
        when coalesce(p_amount_to_collect, 0) > 0
          then format(' · COD collect %s BDT', to_char(p_amount_to_collect, 'FM999999990.00'))
        else ''
      end
    ),
    p_seller_id
  );

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    placed_order.retailer_id,
    p_order_id,
    'order_shipped',
    'Your order was shipped',
    format('Order shipped via Pathao. Consignment: %s.', v_consignment)
  );

  return jsonb_build_object(
    'id', v_shipment.id,
    'orderId', p_order_id,
    'status', 'shipped',
    'provider', 'pathao',
    'consignmentId', v_consignment,
    'carrier', 'Pathao',
    'trackingNumber', v_consignment,
    'trackingUrl', v_tracking_url,
    'shipmentStatus', v_shipment.status,
    'pathaoStatus', v_shipment.pathao_status,
    'shippedAt', v_shipment.shipped_at
  );
end;
$$;

revoke execute on function public.service_create_pathao_shipment(
  uuid, uuid, text, text, numeric, text, text, numeric
) from public, anon, authenticated;
grant execute on function public.service_create_pathao_shipment(
  uuid, uuid, text, text, numeric, text, text, numeric
) to service_role;

-- Apply Pathao webhook / sync updates. Marks COD paid when Pathao delivers.
create or replace function public.service_apply_pathao_event(
  p_consignment_id text default null,
  p_merchant_order_id text default null,
  p_event text default null,
  p_pathao_status text default null,
  p_delivery_fee numeric default null,
  p_collected_amount numeric default null,
  p_message text default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment public.order_shipments%rowtype;
  placed_order public.orders%rowtype;
  v_event text := lower(btrim(coalesce(p_event, '')));
  v_pathao_status text := nullif(btrim(coalesce(p_pathao_status, '')), '');
  v_shipment_status text;
  v_event_type text := 'note';
  v_message text := btrim(coalesce(p_message, ''));
  v_occurred_at timestamptz := coalesce(p_occurred_at, now());
  v_order_updated boolean := false;
  v_cod_collected boolean := false;
  v_merchant_order uuid;
begin
  if p_consignment_id is not null and btrim(p_consignment_id) <> '' then
    select *
    into v_shipment
    from public.order_shipments
    where consignment_id = btrim(p_consignment_id)
       or tracking_number = btrim(p_consignment_id)
    for update;
  end if;

  if v_shipment.id is null
    and p_merchant_order_id is not null
    and btrim(p_merchant_order_id) <> ''
  then
    begin
      v_merchant_order := btrim(p_merchant_order_id)::uuid;
    exception
      when invalid_text_representation then
        v_merchant_order := null;
    end;

    if v_merchant_order is not null then
      select *
      into v_shipment
      from public.order_shipments
      where order_id = v_merchant_order
        and provider = 'pathao'
      for update;
    end if;
  end if;

  if v_shipment.id is null then
    raise exception 'Pathao shipment not found.';
  end if;

  select *
  into placed_order
  from public.orders
  where id = v_shipment.order_id
  for update;

  if placed_order.id is null then
    raise exception 'Order not found.';
  end if;

  if v_pathao_status is null and v_event <> '' then
    v_pathao_status := replace(v_event, 'order.', '');
  end if;

  v_shipment_status := case
    when v_event in (
      'order.delivered',
      'order.partial-delivery',
      'order.paid'
    ) or lower(coalesce(v_pathao_status, '')) in ('delivered', 'partial_delivery', 'paid')
      then 'delivered'
    when v_event in (
      'order.assigned-for-delivery',
      'order.received-at-last-mile-hub'
    ) or lower(coalesce(v_pathao_status, '')) in (
      'assigned_for_delivery',
      'received_at_last_mile_hub',
      'out_for_delivery'
    )
      then 'out_for_delivery'
    when v_event in (
      'order.picked',
      'order.at-the-sorting-hub',
      'order.in-transit',
      'order.assigned-for-pickup',
      'order.pickup-requested'
    ) or lower(coalesce(v_pathao_status, '')) in (
      'picked',
      'in_transit',
      'at_the_sorting_hub',
      'assigned_for_pickup',
      'pickup_requested'
    )
      then 'in_transit'
    when v_event in (
      'order.returned',
      'order.delivery-failed',
      'order.on-hold',
      'order.pickup-failed',
      'order.pickup-cancelled',
      'order.paid-return',
      'order.returned-to-merchant'
    ) or lower(coalesce(v_pathao_status, '')) in (
      'returned',
      'delivery_failed',
      'on_hold',
      'pickup_failed',
      'pickup_cancelled',
      'exception'
    )
      then 'exception'
    else v_shipment.status
  end;

  v_event_type := case v_shipment_status
    when 'in_transit' then 'in_transit'
    when 'out_for_delivery' then 'out_for_delivery'
    when 'delivered' then 'delivered'
    when 'exception' then 'exception'
    else 'note'
  end;

  if v_message = '' then
    v_message := coalesce(
      nullif(v_pathao_status, ''),
      nullif(v_event, ''),
      format('Pathao update · %s', v_shipment_status)
    );
  end if;

  if char_length(v_message) > 500 then
    v_message := left(v_message, 500);
  end if;

  update public.order_shipments
  set status = v_shipment_status,
      pathao_status = coalesce(v_pathao_status, pathao_status),
      pathao_delivery_fee = coalesce(p_delivery_fee, pathao_delivery_fee),
      collected_amount = case
        when p_collected_amount is not null then greatest(p_collected_amount, 0)
        else collected_amount
      end,
      updated_at = now()
  where id = v_shipment.id
  returning * into v_shipment;

  insert into public.shipment_events (
    shipment_id,
    event_type,
    message,
    occurred_at,
    created_by
  )
  values (
    v_shipment.id,
    v_event_type,
    v_message,
    v_occurred_at,
    null
  );

  if v_shipment_status = 'delivered'
    and placed_order.status = 'shipped'
    and not placed_order.cancel_requested
  then
    update public.orders
    set status = 'delivered',
        delivered_at = coalesce(delivered_at, now())
    where id = placed_order.id;
    v_order_updated := true;

    insert into public.notifications (recipient_id, order_id, type, title, message)
    values (
      placed_order.retailer_id,
      placed_order.id,
      'order_delivered',
      'Your order was delivered',
      format(
        'Pathao marked order #%s delivered. Please verify receipt in your orders.',
        upper(substr(placed_order.id::text, 1, 8))
      )
    );
  end if;

  if placed_order.payment_method = 'cod'
    and placed_order.payment_status = 'unpaid'
    and placed_order.delivery_payment_status = 'paid'
    and placed_order.status is distinct from 'pending'
    and placed_order.status is distinct from 'cancelled'
    and (
      v_shipment_status = 'delivered'
      or coalesce(p_collected_amount, 0) > 0
      or v_event in ('order.delivered', 'order.partial-delivery', 'order.paid')
    )
  then
    update public.orders
    set payment_status = 'paid',
        paid_at = coalesce(paid_at, now())
    where id = placed_order.id
      and payment_status = 'unpaid';

    if found then
      v_cod_collected := true;
      insert into public.notifications (recipient_id, order_id, type, title, message)
      values (
        placed_order.retailer_id,
        placed_order.id,
        'cod_collected',
        'Cash on delivery collected',
        format(
          'Pathao collected cash for order #%s. SoukCart will settle with your supplier.',
          upper(substr(placed_order.id::text, 1, 8))
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'shipmentId', v_shipment.id,
    'orderId', v_shipment.order_id,
    'shipmentStatus', v_shipment.status,
    'pathaoStatus', v_shipment.pathao_status,
    'orderUpdated', v_order_updated,
    'codCollected', v_cod_collected
  );
end;
$$;

revoke execute on function public.service_apply_pathao_event(
  text, text, text, text, numeric, numeric, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.service_apply_pathao_event(
  text, text, text, text, numeric, numeric, text, timestamptz
) to service_role;

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
          'provider', shipment.provider,
          'consignment_id', shipment.consignment_id,
          'pathao_status', shipment.pathao_status,
          'pathao_delivery_fee', shipment.pathao_delivery_fee,
          'collected_amount', shipment.collected_amount,
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
