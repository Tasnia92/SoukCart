-- Retailer insights are all-time: the suppliers screen no longer has range
-- tabs, a summary strip, or a top-cities card, so drop the day-window
-- parameter and return only the retailer rows.

drop function if exists public.seller_customer_insights(integer);

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
    group by retailer.id, retailer.name, retailer.email
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
