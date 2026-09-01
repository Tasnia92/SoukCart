-- Trigger helpers are internal implementation details, not browser-callable RPCs.
revoke execute on function public.enforce_order_item_stock() from public, anon, authenticated;
revoke execute on function public.apply_order_stock_delta(uuid, integer) from public, anon, authenticated;
revoke execute on function public.handle_order_status_stock() from public, anon, authenticated;

-- These three RPCs are part of the authenticated browser contract.
revoke execute on function public.supplier_orders() from public, anon;
revoke execute on function public.seller_set_order_status(uuid, text) from public, anon;
revoke execute on function public.request_order_cancellation(uuid) from public, anon;

grant execute on function public.supplier_orders() to authenticated;
grant execute on function public.seller_set_order_status(uuid, text) to authenticated;
grant execute on function public.request_order_cancellation(uuid) to authenticated;
