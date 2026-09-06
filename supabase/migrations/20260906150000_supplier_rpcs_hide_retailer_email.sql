-- Retailer emails are no longer shown to suppliers. Strip retailer email from
-- the three data RPCs the supplier workspace calls, so it is not exposed in
-- API responses (admin-facing RPCs keep it).

-- 1) Supplier order list.
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
      placed_order.delivery_initiated_at,
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
      (
        select shipment.status
        from public.order_shipments as shipment
        where shipment.order_id = placed_order.id
          and shipment.seller_id = (select auth.uid())
        limit 1
      ) as shipment_status,
      placed_order.notes,
      placed_order.created_at,
      retailer.name as retailer_name,
      acceptance.accepted_at,
      coalesce(acceptance.status, 'pending') as package_status,
      acceptance.declined_at,
      acceptance.decline_reason,
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
grant execute on function public.supplier_orders()
to authenticated;

-- 2) Supplier dashboard summary (queue rows no longer carry the email).
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

-- 3) Retailer list (all-time).
create or replace function public.seller_customer_insights()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_customers jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(ranked)), '[]'::jsonb)
  into v_customers
  from (
    select
      retailer.id as "retailerId",
      retailer.name as "retailerName",
      count(*)::integer as "orderCount",
      coalesce(sum(seller_line.supplier_total), 0)::numeric(12, 2) as "grossSales",
      round(coalesce(avg(seller_line.supplier_total), 0), 2)::numeric(12, 2) as "averageOrderValue",
      min(seller_line.created_at) as "firstOrderAt",
      max(seller_line.created_at) as "lastOrderAt",
      (
        select city_line.delivery_city
        from (
          select placed_order.delivery_city
          from public.orders as placed_order
          join public.order_items as item
            on item.order_id = placed_order.id
           and item.seller_id = v_seller_id
          where placed_order.retailer_id = retailer.id
            and placed_order.status is distinct from 'cancelled'
            and placed_order.delivery_city is not null
            and btrim(placed_order.delivery_city) <> ''
        ) as city_line
        group by city_line.delivery_city
        order by count(*) desc, city_line.delivery_city
        limit 1
      ) as "topCity",
      count(*) filter (where seller_line.status = 'delivered')::integer as "deliveredCount"
    from public.users as retailer
    join (
      select
        placed_order.id as order_id,
        placed_order.retailer_id,
        placed_order.status,
        placed_order.created_at,
        coalesce(sum(item.quantity * item.unit_price), 0)::numeric(12, 2) as supplier_total
      from public.orders as placed_order
      join public.order_items as item
        on item.order_id = placed_order.id
       and item.seller_id = v_seller_id
      where placed_order.status is distinct from 'cancelled'
      group by
        placed_order.id,
        placed_order.retailer_id,
        placed_order.status,
        placed_order.created_at
    ) as seller_line on seller_line.retailer_id = retailer.id
    group by retailer.id, retailer.name
    order by sum(seller_line.supplier_total) desc, max(seller_line.created_at) desc
    limit 100
  ) as ranked;

  return jsonb_build_object(
    'customers', coalesce(v_customers, '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.seller_customer_insights() from public, anon;
grant execute on function public.seller_customer_insights() to authenticated;
