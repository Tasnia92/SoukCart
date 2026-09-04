-- P3: Order-centric customer insights for approved sellers.
-- Aggregates only retailers who bought this seller's items — no CRM store.

create or replace function public.seller_customer_insights(p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_days integer := greatest(1, least(coalesce(p_days, 90), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_unique integer := 0;
  v_repeat integer := 0;
  v_orders integer := 0;
  v_gross numeric(12, 2) := 0;
  v_aov numeric(12, 2) := 0;
  v_customers jsonb := '[]'::jsonb;
  v_cities jsonb := '[]'::jsonb;
begin
  with seller_orders as (
    select
      placed_order.id as order_id,
      placed_order.retailer_id,
      placed_order.status,
      placed_order.created_at,
      placed_order.delivery_city,
      coalesce(sum(item.quantity * item.unit_price), 0)::numeric(12, 2) as supplier_total
    from public.orders as placed_order
    join public.order_items as item
      on item.order_id = placed_order.id
     and item.seller_id = v_seller_id
    where placed_order.created_at >= v_since
      and placed_order.status is distinct from 'cancelled'
    group by
      placed_order.id,
      placed_order.retailer_id,
      placed_order.status,
      placed_order.created_at,
      placed_order.delivery_city
  ),
  per_customer as (
    select
      seller_orders.retailer_id,
      count(*)::integer as order_count,
      coalesce(sum(seller_orders.supplier_total), 0)::numeric(12, 2) as gross_sales
    from seller_orders
    group by seller_orders.retailer_id
  )
  select
    coalesce(count(*)::integer, 0),
    coalesce(count(*) filter (where order_count >= 2)::integer, 0),
    coalesce(sum(order_count)::integer, 0),
    coalesce(sum(gross_sales), 0),
    case
      when coalesce(sum(order_count), 0) > 0
        then round(coalesce(sum(gross_sales), 0) / sum(order_count), 2)
      else 0
    end
  into v_unique, v_repeat, v_orders, v_gross, v_aov
  from per_customer;

  select coalesce(jsonb_agg(to_jsonb(ranked)), '[]'::jsonb)
  into v_customers
  from (
    select
      retailer.id as "retailerId",
      retailer.name as "retailerName",
      retailer.email as "retailerEmail",
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
            and placed_order.created_at >= v_since
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
      where placed_order.created_at >= v_since
        and placed_order.status is distinct from 'cancelled'
      group by
        placed_order.id,
        placed_order.retailer_id,
        placed_order.status,
        placed_order.created_at
    ) as seller_line on seller_line.retailer_id = retailer.id
    group by retailer.id, retailer.name, retailer.email
    order by sum(seller_line.supplier_total) desc, max(seller_line.created_at) desc
    limit 100
  ) as ranked;

  select coalesce(jsonb_agg(to_jsonb(city_row)), '[]'::jsonb)
  into v_cities
  from (
    select
      coalesce(nullif(btrim(placed_order.delivery_city), ''), 'Unknown') as city,
      count(distinct placed_order.id)::integer as "orderCount",
      coalesce(sum(item.quantity * item.unit_price), 0)::numeric(12, 2) as "grossSales"
    from public.orders as placed_order
    join public.order_items as item
      on item.order_id = placed_order.id
     and item.seller_id = v_seller_id
    where placed_order.created_at >= v_since
      and placed_order.status is distinct from 'cancelled'
    group by 1
    order by sum(item.quantity * item.unit_price) desc, count(distinct placed_order.id) desc
    limit 10
  ) as city_row;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'windowDays', v_days,
      'uniqueCustomers', coalesce(v_unique, 0),
      'repeatCustomers', coalesce(v_repeat, 0),
      'orderCount', coalesce(v_orders, 0),
      'grossSales', coalesce(v_gross, 0),
      'averageOrderValue', coalesce(v_aov, 0)
    ),
    'customers', coalesce(v_customers, '[]'::jsonb),
    'topCities', coalesce(v_cities, '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.seller_customer_insights(integer) from public, anon;
grant execute on function public.seller_customer_insights(integer) to authenticated;
