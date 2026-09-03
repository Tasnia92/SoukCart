-- Auto-expire abandoned online checkouts.
--
-- Online orders reserve stock at creation (create_order_from_cart deducts
-- inventory and sets stock_reserved = true) so two buyers can never claim the
-- last unit. But if a buyer opens the SSLCommerz gateway and never returns,
-- nothing settles the order and the reserved stock is held forever.
--
-- This job fails any online order still unpaid after the gateway session
-- window (~30 minutes). Setting payment_status = 'failed' fires
-- handle_order_inventory_reservation, which returns the reserved units to
-- sellable stock. COD orders are excluded: they stay unpaid until cash is
-- collected at delivery.

create extension if not exists pg_cron;

create or replace function public.expire_stale_unpaid_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer;
begin
  with expired as (
    update public.orders
    set payment_status = 'failed'
    where payment_method = 'online'
      and payment_status = 'unpaid'
      and status <> 'cancelled'
      and stock_reserved = true
      and created_at < now() - interval '30 minutes'
    returning id
  )
  select count(*) into expired_count from expired;

  return expired_count;
end;
$$;

revoke execute on function public.expire_stale_unpaid_orders()
from public, anon, authenticated;

-- cron.schedule upserts by job name, so re-applying this migration simply
-- refreshes the existing schedule instead of creating a duplicate.
select cron.schedule(
  'expire-stale-unpaid-orders',
  '*/5 * * * *',
  $$select public.expire_stale_unpaid_orders();$$
);
