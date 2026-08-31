create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

alter table public.cart_items enable row level security;

create policy cart_items_read_own
on public.cart_items
for select
to authenticated
using (user_id = auth.uid());

create policy cart_items_insert_own
on public.cart_items
for insert
to authenticated
with check (user_id = auth.uid());

create policy cart_items_update_own
on public.cart_items
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy cart_items_delete_own
on public.cart_items
for delete
to authenticated
using (user_id = auth.uid());
