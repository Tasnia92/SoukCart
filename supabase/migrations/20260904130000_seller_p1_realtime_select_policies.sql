-- P1: Let approved sellers SELECT their own order/payout rows so Realtime
-- postgres_changes can deliver events (Realtime respects RLS). Publish the
-- tables sellers need for an action-first live dashboard.

grant select on table public.seller_payouts to authenticated;

drop policy if exists orders_read_as_supplier on public.orders;
create policy orders_read_as_supplier
  on public.orders
  for select
  to authenticated
  using (
    private.is_approved_supplier((select auth.uid()))
    and exists (
      select 1
      from public.order_items as item
      where item.order_id = orders.id
        and item.seller_id = (select auth.uid())
    )
  );

drop policy if exists order_items_read_as_supplier on public.order_items;
create policy order_items_read_as_supplier
  on public.order_items
  for select
  to authenticated
  using (
    private.is_approved_supplier((select auth.uid()))
    and seller_id = (select auth.uid())
  );

drop policy if exists seller_payouts_read_own on public.seller_payouts;
create policy seller_payouts_read_own
  on public.seller_payouts
  for select
  to authenticated
  using (
    seller_id = (select auth.uid())
    and private.is_approved_supplier((select auth.uid()))
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'seller_payouts'
  ) then
    alter publication supabase_realtime add table public.seller_payouts;
  end if;
end;
$$;
