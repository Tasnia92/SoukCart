-- Fix seller order acceptance failing with SQLSTATE 42702.
--
-- seller_accept_order declared a PL/pgSQL variable named supplier_id, which
-- shadowed order_supplier_acceptances.supplier_id inside the INSERT ... VALUES
-- statement. Postgres could not tell whether "supplier_id" referred to the
-- variable or the target column, so every acceptance aborted with:
--   column reference "supplier_id" is ambiguous
-- Renaming the variable to v_supplier_id removes the collision. Behaviour is
-- otherwise unchanged.

create or replace function public.seller_accept_order(p_order_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid := (select auth.uid());
  order_status text;
  cancellation_pending boolean;
  accepted timestamptz;
begin
  if v_supplier_id is null or not exists (
    select 1
    from public.users as account
    where account.id = v_supplier_id and account.role = 'seller'
  ) then
    raise exception 'A supplier account is required to accept orders.';
  end if;

  select placed_order.status, placed_order.cancel_requested
  into order_status, cancellation_pending
  from public.orders as placed_order
  where placed_order.id = p_order_id
  for update;

  if order_status is null
    or order_status <> 'pending'
    or cancellation_pending
    or not exists (
      select 1
      from public.order_items as item
      join public.products as product on product.id = item.product_id
      where item.order_id = p_order_id
        and product.seller_id = v_supplier_id
    )
  then
    raise exception 'This order is not available for acceptance.';
  end if;

  insert into public.order_supplier_acceptances (order_id, supplier_id)
  values (p_order_id, v_supplier_id)
  on conflict (order_id, supplier_id) do update
    set accepted_at = public.order_supplier_acceptances.accepted_at
  returning accepted_at into accepted;

  return accepted;
end;
$$;

revoke execute on function public.seller_accept_order(uuid) from public, anon;
grant execute on function public.seller_accept_order(uuid) to authenticated;
