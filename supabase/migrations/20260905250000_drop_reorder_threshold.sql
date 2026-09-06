-- Drop the per-product reorder threshold. Retailer reorders are governed by
-- min_order_qty, so the value never needed separate storage; low-stock alerts
-- use the fixed default of 5 units (LOW_STOCK_THRESHOLD in the app code and
-- the latest seller_nav_badges definition).

alter table public.products
  drop constraint if exists products_reorder_threshold_nonnegative;

alter table public.products
  drop column if exists reorder_threshold;

-- seller_adjust_stock: drop the threshold-carrying six-argument overload and
-- recreate the stock write without it.
drop function if exists public.seller_adjust_stock(uuid, text, integer, integer, text, integer);

create or replace function public.seller_adjust_stock(
  p_product_id uuid,
  p_mode text,
  p_value integer,
  p_expected_version integer,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_mode text := lower(btrim(coalesce(p_mode, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_product public.products%rowtype;
  v_previous integer;
  v_next integer;
begin
  if v_mode is distinct from 'absolute' and v_mode is distinct from 'relative' then
    raise exception 'Stock mode must be absolute or relative.';
  end if;

  if p_value is null or (v_mode = 'absolute' and p_value < 0) then
    raise exception 'Stock quantity must be a whole number of 0 or more.';
  end if;

  if char_length(v_reason) > 200 then
    raise exception 'Adjustment reason must be 200 characters or fewer.';
  end if;

  select *
  into v_product
  from public.products as product
  where product.id = p_product_id
    and product.seller_id = v_seller_id
  for update;

  if not found then
    raise exception 'Product not found.';
  end if;

  if p_expected_version is distinct from v_product.stock_version then
    raise exception 'Stock changed elsewhere. Refresh and try again.';
  end if;

  v_previous := v_product.stock;
  if v_mode = 'absolute' then
    v_next := p_value;
  else
    v_next := v_previous + p_value;
  end if;

  if v_next < 0 then
    raise exception 'Stock cannot go below 0.';
  end if;

  update public.products as product
  set
    stock = v_next,
    stock_version = product.stock_version + 1
  where product.id = v_product.id;

  insert into public.stock_adjustments (
    product_id,
    seller_id,
    previous_stock,
    new_stock,
    delta,
    reason
  )
  values (
    v_product.id,
    v_seller_id,
    v_previous,
    v_next,
    v_next - v_previous,
    v_reason
  );

  return jsonb_build_object(
    'id', v_product.id,
    'stock', v_next,
    'stockVersion', v_product.stock_version + 1,
    'previousStock', v_previous,
    'delta', v_next - v_previous
  );
end;
$$;

revoke execute on function public.seller_adjust_stock(uuid, text, integer, integer, text)
from public, anon;
grant execute on function public.seller_adjust_stock(uuid, text, integer, integer, text)
to authenticated;

comment on function public.seller_adjust_stock(uuid, text, integer, integer, text) is
  'Approved seller stock write with optimistic concurrency and adjustment history.';

create or replace function public.seller_bulk_adjust_stock(p_adjustments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_item jsonb;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_mode text;
  v_value integer;
  v_version integer;
  v_product_id uuid;
  v_reason text;
begin
  if p_adjustments is null or jsonb_typeof(p_adjustments) is distinct from 'array' then
    raise exception 'Adjustments must be a JSON array.';
  end if;

  if jsonb_array_length(p_adjustments) = 0 then
    raise exception 'Provide at least one stock adjustment.';
  end if;

  if jsonb_array_length(p_adjustments) > 200 then
    raise exception 'Bulk stock updates are limited to 200 rows at a time.';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_adjustments)
  loop
    begin
      v_product_id := (v_item ->> 'productId')::uuid;
    exception
      when others then
        raise exception 'Each adjustment needs a valid productId.';
    end;

    v_mode := lower(btrim(coalesce(v_item ->> 'mode', 'absolute')));
    v_value := (v_item ->> 'value')::integer;
    v_version := (v_item ->> 'expectedVersion')::integer;
    v_reason := coalesce(v_item ->> 'reason', '');

    v_result := public.seller_adjust_stock(
      v_product_id,
      v_mode,
      v_value,
      v_version,
      v_reason
    );
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object(
    'sellerId', v_seller_id,
    'updated', jsonb_array_length(v_results),
    'results', v_results
  );
end;
$$;

revoke execute on function public.seller_bulk_adjust_stock(jsonb) from public, anon;
grant execute on function public.seller_bulk_adjust_stock(jsonb) to authenticated;

comment on function public.seller_bulk_adjust_stock(jsonb) is
  'Applies up to 200 seller stock adjustments atomically via seller_adjust_stock.';

-- Dashboard summary: low-stock / healthy counts use the fixed 5-unit threshold,
-- matching LOW_STOCK_THRESHOLD in src/features/supplier/supplier-dashboard-api.ts.
create or replace function public.seller_dashboard_summary(p_window_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_window_days integer := greatest(1, least(coalesce(p_window_days, 30), 90));
  v_now timestamptz := now();
  v_window_start timestamptz := v_now - make_interval(days => v_window_days);
  v_prev_start timestamptz := v_now - make_interval(days => v_window_days * 2);
  v_sales numeric := 0;
  v_previous_sales numeric := 0;
  v_orders integer := 0;
  v_orders_completed integer := 0;
  v_to_confirm integer := 0;
  v_to_ship integer := 0;
  v_awaiting_payment integer := 0;
  v_awaiting_fulfillment integer := 0;
  v_cancellation_requests integer := 0;
  v_active_listings integer := 0;
  v_total_listings integer := 0;
  v_low_stock integer := 0;
  v_out_of_stock integer := 0;
  v_commission_rate numeric(5, 4) := 0;
  v_available numeric := 0;
  v_paid numeric := 0;
  v_commission numeric := 0;
  v_net_earnings numeric := 0;
  v_series jsonb := '[]'::jsonb;
  v_queue jsonb := '[]'::jsonb;
  v_stock_risk jsonb := '[]'::jsonb;
  v_top_products jsonb := '[]'::jsonb;
  v_recent_listings jsonb := '[]'::jsonb;
  v_healthy integer := 0;
  v_delta_percent numeric;
  v_delta_direction text;
  v_delta_label text;
begin
  select coalesce(commission_rate, 0)
  into v_commission_rate
  from public.platform_settings
  where id = 'default';

  select
    coalesce(sum(case when payout.status = 'available' then payout.net_payable else 0 end), 0),
    coalesce(sum(case when payout.status = 'paid' then payout.net_payable else 0 end), 0),
    coalesce(sum(case when payout.status in ('available', 'paid') then payout.commission_amount else 0 end), 0)
  into v_available, v_paid, v_commission
  from public.seller_payouts as payout
  where payout.seller_id = v_seller_id;

  v_net_earnings := v_available + v_paid;

  select
    coalesce(sum(case
      when placed_order.status is distinct from 'cancelled'
        and placed_order.payment_status = 'paid'
        and placed_order.created_at >= v_window_start
      then item_total.supplier_total
      else 0
    end), 0),
    coalesce(sum(case
      when placed_order.status is distinct from 'cancelled'
        and placed_order.payment_status = 'paid'
        and placed_order.created_at >= v_prev_start
        and placed_order.created_at < v_window_start
      then item_total.supplier_total
      else 0
    end), 0),
    coalesce(count(distinct case
      when placed_order.status is distinct from 'cancelled'
        and placed_order.payment_status = 'paid'
        and placed_order.created_at >= v_window_start
      then placed_order.id
    end), 0)::integer,
    coalesce(count(distinct case
      when placed_order.status = 'delivered'
        and placed_order.created_at >= v_window_start
      then placed_order.id
    end), 0)::integer,
    coalesce(count(distinct case
      when not coalesce(placed_order.cancel_requested, false)
        and placed_order.status = 'pending'
        and (placed_order.payment_method = 'cod' or placed_order.payment_status = 'paid')
      then placed_order.id
    end), 0)::integer,
    coalesce(count(distinct case
      when not coalesce(placed_order.cancel_requested, false)
        and placed_order.status = 'confirmed'
        and (placed_order.payment_method = 'cod' or placed_order.payment_status = 'paid')
      then placed_order.id
    end), 0)::integer,
    coalesce(count(distinct case
      when placed_order.status = 'pending'
        and placed_order.payment_method is distinct from 'cod'
        and placed_order.payment_status is distinct from 'paid'
        and not coalesce(placed_order.cancel_requested, false)
      then placed_order.id
    end), 0)::integer,
    coalesce(count(distinct case
      when placed_order.cancel_requested
        and placed_order.status is distinct from 'cancelled'
      then placed_order.id
    end), 0)::integer
  into
    v_sales,
    v_previous_sales,
    v_orders,
    v_orders_completed,
    v_to_confirm,
    v_to_ship,
    v_awaiting_payment,
    v_cancellation_requests
  from public.orders as placed_order
  join lateral (
    select coalesce(sum(item.quantity * item.unit_price), 0) as supplier_total
    from public.order_items as item
    where item.order_id = placed_order.id
      and item.seller_id = v_seller_id
  ) as item_total on true
  where exists (
    select 1
    from public.order_items as item
    where item.order_id = placed_order.id
      and item.seller_id = v_seller_id
  );

  v_awaiting_fulfillment := v_to_confirm + v_to_ship;

  if v_previous_sales = 0 then
    if v_sales = 0 then
      v_delta_direction := 'flat';
      v_delta_percent := null;
      v_delta_label := format('No change vs previous %s days', v_window_days);
    else
      v_delta_direction := 'new';
      v_delta_percent := null;
      v_delta_label := format('First activity in %s days', v_window_days * 2);
    end if;
  else
    v_delta_percent := round(((v_sales - v_previous_sales) / v_previous_sales) * 100);
    if v_delta_percent = 0 then
      v_delta_direction := 'flat';
      v_delta_label := format('No change vs previous %s days', v_window_days);
    elsif v_delta_percent > 0 then
      v_delta_direction := 'up';
      v_delta_label := format('+%s%% vs previous %s days', abs(v_delta_percent), v_window_days);
    else
      v_delta_direction := 'down';
      v_delta_label := format('−%s%% vs previous %s days', abs(v_delta_percent), v_window_days);
    end if;
  end if;

  select
    coalesce(count(*) filter (where product.is_active), 0)::integer,
    coalesce(count(*), 0)::integer,
    coalesce(count(*) filter (
      where product.is_active
        and product.stock > 0
        and product.stock <= 5
    ), 0)::integer,
    coalesce(count(*) filter (where product.is_active and product.stock <= 0), 0)::integer,
    coalesce(count(*) filter (
      where product.is_active
        and product.stock > 5
    ), 0)::integer
  into v_active_listings, v_total_listings, v_low_stock, v_out_of_stock, v_healthy
  from public.products as product
  where product.seller_id = v_seller_id;

  select coalesce(jsonb_agg(day_bucket order by sort_day), '[]'::jsonb)
  into v_series
  from (
    select
      jsonb_build_object(
        'key', to_char(day_start, 'YYYY-MM-DD'),
        'label', to_char(day_start, 'DD Mon'),
        'startsAt', (extract(epoch from day_start) * 1000)::bigint,
        'value', coalesce(day_sales.value, 0),
        'count', coalesce(day_sales.count, 0)
      ) as day_bucket,
      day_start::date as sort_day
    from generate_series(
      date_trunc('day', timezone('Asia/Dhaka', v_window_start)),
      date_trunc('day', timezone('Asia/Dhaka', v_now)),
      interval '1 day'
    ) as day_start
    left join lateral (
      select
        coalesce(sum(item.quantity * item.unit_price), 0) as value,
        count(distinct placed_order.id)::integer as count
      from public.orders as placed_order
      join public.order_items as item
        on item.order_id = placed_order.id
       and item.seller_id = v_seller_id
      where placed_order.status is distinct from 'cancelled'
        and placed_order.payment_status = 'paid'
        and date_trunc('day', timezone('Asia/Dhaka', placed_order.created_at)) = day_start
    ) as day_sales on true
  ) as series_rows;

  select coalesce(jsonb_agg(queue_row order by sort_at), '[]'::jsonb)
  into v_queue
  from (
    select
      jsonb_build_object(
        'id', placed_order.id,
        'retailerName', retailer.name,
        'retailerEmail', retailer.email,
        'createdAt', placed_order.created_at,
        'ageDays', greatest(0, floor(extract(epoch from (v_now - placed_order.created_at)) / 86400))::integer,
        'units', coalesce((
          select sum(item.quantity)::integer
          from public.order_items as item
          where item.order_id = placed_order.id
            and item.seller_id = v_seller_id
        ), 0),
        'total', coalesce((
          select sum(item.quantity * item.unit_price)
          from public.order_items as item
          where item.order_id = placed_order.id
            and item.seller_id = v_seller_id
        ), 0),
        'status', placed_order.status,
        'paymentStatus', placed_order.payment_status,
        'paymentMethod', placed_order.payment_method,
        'accepted', acceptance.accepted_at is not null,
        'cancelRequested', coalesce(placed_order.cancel_requested, false),
        'severity', case
          when coalesce(placed_order.cancel_requested, false) then 'critical'
          when placed_order.created_at <= v_now - interval '1 day' then 'critical'
          else 'attention'
        end
      ) as queue_row,
      placed_order.created_at as sort_at
    from public.orders as placed_order
    join public.users as retailer on retailer.id = placed_order.retailer_id
    left join public.order_supplier_acceptances as acceptance
      on acceptance.order_id = placed_order.id
     and acceptance.supplier_id = v_seller_id
    where exists (
        select 1
        from public.order_items as item
        where item.order_id = placed_order.id
          and item.seller_id = v_seller_id
      )
      and (
        (
          coalesce(placed_order.cancel_requested, false)
          and placed_order.status is distinct from 'cancelled'
        )
        or (
          not coalesce(placed_order.cancel_requested, false)
          and placed_order.status in ('pending', 'confirmed')
          and (placed_order.payment_method = 'cod' or placed_order.payment_status = 'paid')
        )
      )
    order by placed_order.created_at asc
    limit 6
  ) as queue_rows;

  select coalesce(jsonb_agg(risk_row order by stock_sort, name_sort), '[]'::jsonb)
  into v_stock_risk
  from (
    select
      jsonb_build_object(
        'id', product.id,
        'name', product.name,
        'unit', product.unit,
        'stock', product.stock,
        'isActive', product.is_active,
        'severity', case when product.stock <= 0 then 'critical' else 'attention' end
      ) as risk_row,
      product.stock as stock_sort,
      product.name as name_sort
    from public.products as product
    where product.seller_id = v_seller_id
      and product.is_active
      and product.stock <= 5
    order by product.stock asc, product.name asc
    limit 5
  ) as risk_rows;

  select coalesce(jsonb_agg(top_row order by value desc, units desc), '[]'::jsonb)
  into v_top_products
  from (
    select
      jsonb_build_object(
        'id', ranked.product_id,
        'name', ranked.product_name,
        'units', ranked.units,
        'value', ranked.value
      ) as top_row,
      ranked.value,
      ranked.units
    from (
      select
        item.product_id,
        max(item.product_name) as product_name,
        sum(item.quantity)::integer as units,
        sum(item.quantity * item.unit_price) as value
      from public.orders as placed_order
      join public.order_items as item
        on item.order_id = placed_order.id
       and item.seller_id = v_seller_id
      where placed_order.status is distinct from 'cancelled'
        and placed_order.payment_status = 'paid'
        and placed_order.created_at >= v_window_start
      group by item.product_id
      order by sum(item.quantity * item.unit_price) desc, sum(item.quantity) desc
      limit 5
    ) as ranked
  ) as top_rows;

  select coalesce(jsonb_agg(listing_row order by created_sort desc), '[]'::jsonb)
  into v_recent_listings
  from (
    select
      jsonb_build_object(
        'id', product.id,
        'name', product.name,
        'description', product.description,
        'price', product.price,
        'unit', product.unit,
        'stock', product.stock,
        'min_order_qty', product.min_order_qty,
        'category', product.category,
        'image_url', product.image_url,
        'is_active', product.is_active,
        'created_at', product.created_at
      ) as listing_row,
      product.created_at as created_sort
    from public.products as product
    where product.seller_id = v_seller_id
    order by product.created_at desc
    limit 3
  ) as listing_rows;

  return jsonb_build_object(
    'windowDays', v_window_days,
    'summary', jsonb_build_object(
      'sales', v_sales,
      'salesDelta', jsonb_build_object(
        'direction', v_delta_direction,
        'percent', v_delta_percent,
        'label', v_delta_label
      ),
      'orders', v_orders,
      'ordersCompleted', v_orders_completed,
      'toConfirm', v_to_confirm,
      'toShip', v_to_ship,
      'awaitingPayment', v_awaiting_payment,
      'awaitingFulfillment', v_awaiting_fulfillment,
      'cancellationRequests', v_cancellation_requests,
      'lowStock', v_low_stock,
      'outOfStock', v_out_of_stock,
      'stockAtRisk', v_low_stock + v_out_of_stock,
      'activeListings', v_active_listings,
      'totalListings', v_total_listings,
      'netEarnings', v_net_earnings
    ),
    'series', coalesce(v_series, '[]'::jsonb),
    'queue', coalesce(v_queue, '[]'::jsonb),
    'stockRisk', coalesce(v_stock_risk, '[]'::jsonb),
    'stockHealth', jsonb_build_object(
      'total', v_active_listings,
      'segments', jsonb_build_array(
        jsonb_build_object(
          'key', 'healthy',
          'label', 'Well stocked',
          'count', v_healthy,
          'severity', 'positive',
          'percent', case when v_active_listings = 0 then 0 else round((v_healthy::numeric / v_active_listings) * 100) end
        ),
        jsonb_build_object(
          'key', 'low',
          'label', 'Running low',
          'count', v_low_stock,
          'severity', 'attention',
          'percent', case when v_active_listings = 0 then 0 else round((v_low_stock::numeric / v_active_listings) * 100) end
        ),
        jsonb_build_object(
          'key', 'out',
          'label', 'Out of stock',
          'count', v_out_of_stock,
          'severity', 'critical',
          'percent', case when v_active_listings = 0 then 0 else round((v_out_of_stock::numeric / v_active_listings) * 100) end
        )
      )
    ),
    'topProducts', coalesce(v_top_products, '[]'::jsonb),
    'recentListings', coalesce(v_recent_listings, '[]'::jsonb),
    'earnings', jsonb_build_object(
      'commissionRate', coalesce(v_commission_rate, 0),
      'available', v_available,
      'paid', v_paid,
      'commission', v_commission
    )
  );
end;
$$;

revoke execute on function public.seller_dashboard_summary(integer) from public, anon;
grant execute on function public.seller_dashboard_summary(integer) to authenticated;

-- Duplicate product: the copy no longer needs to carry a reorder threshold.
create or replace function public.seller_duplicate_product(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_source public.products%rowtype;
  v_copy_id uuid;
  v_copy_name text;
begin
  select *
  into v_source
  from public.products as product
  where product.id = p_product_id
    and product.seller_id = v_seller_id;

  if not found then
    raise exception 'Product not found.';
  end if;

  v_copy_name := left(btrim(v_source.name) || ' (copy)', 200);

  insert into public.products (
    seller_id,
    name,
    description,
    price,
    unit,
    stock,
    min_order_qty,
    category,
    image_url,
    is_active,
    stock_version
  )
  values (
    v_seller_id,
    v_copy_name,
    v_source.description,
    v_source.price,
    v_source.unit,
    v_source.stock,
    v_source.min_order_qty,
    v_source.category,
    v_source.image_url,
    false,
    0
  )
  returning id into v_copy_id;

  return jsonb_build_object(
    'id', v_copy_id,
    'name', v_copy_name,
    'isActive', false,
    'sourceId', v_source.id
  );
end;
$$;

revoke execute on function public.seller_duplicate_product(uuid) from public, anon;
grant execute on function public.seller_duplicate_product(uuid) to authenticated;

comment on function public.seller_duplicate_product(uuid) is
  'Creates a hidden copy of an approved seller product for quick catalog duplication.';
