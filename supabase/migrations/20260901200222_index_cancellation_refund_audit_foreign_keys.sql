create index if not exists orders_delivery_verified_by_idx
  on public.orders (delivery_verified_by);

create index if not exists orders_cancellation_requested_by_idx
  on public.orders (cancellation_requested_by);

create index if not exists orders_cancelled_by_idx
  on public.orders (cancelled_by);

create index if not exists orders_refund_completed_by_idx
  on public.orders (refund_completed_by);
