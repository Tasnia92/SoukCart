alter table public.orders
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'failed', 'cancelled')),
  add column if not exists tran_id text,
  add column if not exists val_id text,
  add column if not exists sessionkey text,
  add column if not exists bank_tran_id text,
  add column if not exists paid_at timestamptz;

create unique index if not exists orders_tran_id_key
  on public.orders (tran_id)
  where tran_id is not null;