-- Helper used by cancellation refund math. Ensure it exists even when earlier
-- prepaid-delivery migrations were only partially applied remotely.

create or replace function public.order_merchandise_total(p_order_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select round(coalesce(sum(item.quantity * item.unit_price), 0), 2)
  from public.order_items as item
  where item.order_id = p_order_id;
$$;

revoke execute on function public.order_merchandise_total(uuid) from public, anon;
grant execute on function public.order_merchandise_total(uuid) to authenticated, service_role;
