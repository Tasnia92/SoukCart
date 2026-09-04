-- Break orders <-> order_items RLS recursion for retailer reads.

create or replace function private.order_owned_by_retailer(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.orders as placed_order
    where placed_order.id = p_order_id
      and placed_order.retailer_id = (select auth.uid())
  );
$$;

revoke all on function private.order_owned_by_retailer(uuid) from public, anon;
grant execute on function private.order_owned_by_retailer(uuid) to authenticated;

create or replace function private.order_visible_to_supplier(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_approved_supplier((select auth.uid()))
    and exists (
      select 1
      from public.order_items as item
      where item.order_id = p_order_id
        and item.seller_id = (select auth.uid())
    );
$$;

revoke all on function private.order_visible_to_supplier(uuid) from public, anon;
grant execute on function private.order_visible_to_supplier(uuid) to authenticated;

drop policy if exists order_items_read_own on public.order_items;
create policy order_items_read_own
  on public.order_items
  for select
  to authenticated
  using (private.order_owned_by_retailer(order_id));

drop policy if exists orders_read_as_supplier on public.orders;
create policy orders_read_as_supplier
  on public.orders
  for select
  to authenticated
  using (private.order_visible_to_supplier(id));
