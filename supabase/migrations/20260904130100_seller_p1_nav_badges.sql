-- P1: Server-side seller dashboard summary + lightweight nav badge counts.
-- Aggregates on the server so the browser does not download the full order and
-- product catalogs just to render Overview KPIs and action queues.

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
    and product.stock <= 5;

  return jsonb_build_object(
    'needsAction', coalesce(v_needs_action, 0),
    'stockAtRisk', coalesce(v_stock_at_risk, 0)
  );
end;
$$;

revoke execute on function public.seller_nav_badges() from public, anon;
grant execute on function public.seller_nav_badges() to authenticated;
