-- Order cancellation policy:
--   pending   -> customer cancels directly
--   confirmed -> customer requests, admin approves
--   shipped   -> cancellation no longer allowed
--   delivered -> return policy applies instead
-- Status changes belong to the admin edge function; customers go through the RPC.

alter table public.orders
  add column if not exists cancel_requested boolean not null default false,
  add column if not exists cancel_requested_at timestamptz;

create or replace function public.request_order_cancellation(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage your orders.';
  end if;

  select status into current_status
  from orders
  where id = p_order_id and retailer_id = auth.uid();

  if current_status is null then
    raise exception 'Order not found.';
  end if;

  if current_status = 'pending' then
    update orders
    set status = 'cancelled', cancel_requested = false, cancel_requested_at = null
    where id = p_order_id and retailer_id = auth.uid();
    return 'cancelled';
  elsif current_status = 'confirmed' then
    update orders
    set cancel_requested = true, cancel_requested_at = now()
    where id = p_order_id and retailer_id = auth.uid();
    return 'requested';
  else
    raise exception 'This order can no longer be cancelled. Shipped orders cannot be cancelled and delivered orders follow the return policy.';
  end if;
end;
$$;

revoke execute on function public.request_order_cancellation(uuid) from anon;

-- Status is admin-controlled now; the customer cancel path is the RPC above.
drop policy if exists orders_update_own on public.orders;
