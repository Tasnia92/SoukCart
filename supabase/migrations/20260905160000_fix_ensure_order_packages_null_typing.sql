-- DISTINCT forces a concrete type on every select-list column, so a bare
-- "null" was resolved to text and failed against accepted_at timestamptz
-- (42804: column "accepted_at" is of type timestamp with time zone but
-- expression is of type text) for every caller of this helper: admin
-- ship/deliver/cancel, supplier confirm/decline, and order creation.
-- Cast the null explicitly so the insert type-checks.
create or replace function private.ensure_order_packages(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.order_supplier_acceptances (order_id, supplier_id, status, accepted_at)
  select distinct item.order_id, item.seller_id, 'pending', null::timestamptz
  from public.order_items as item
  where item.order_id = p_order_id
    and item.seller_id is not null
  on conflict (order_id, supplier_id) do nothing;
end;
$$;

revoke all on function private.ensure_order_packages(uuid) from public;
grant execute on function private.ensure_order_packages(uuid) to service_role;
