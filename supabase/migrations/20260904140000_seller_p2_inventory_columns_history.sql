-- P2: Per-product reorder thresholds, optimistic stock versions, and adjustment history.

alter table public.products
  add column if not exists reorder_threshold integer not null default 5;

alter table public.products
  add column if not exists stock_version integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_reorder_threshold_nonnegative'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_reorder_threshold_nonnegative
      check (reorder_threshold >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_stock_version_nonnegative'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_stock_version_nonnegative
      check (stock_version >= 0);
  end if;
end;
$$;

comment on column public.products.reorder_threshold is
  'Seller-defined low-stock threshold for this listing. Used by inventory filters and nav badges.';

comment on column public.products.stock_version is
  'Monotonic version bumped on every stock write. Clients pass the expected version for optimistic concurrency.';

create table if not exists public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  seller_id uuid not null references public.users (id) on delete cascade,
  previous_stock integer not null,
  new_stock integer not null,
  delta integer not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  constraint stock_adjustments_previous_stock_nonnegative check (previous_stock >= 0),
  constraint stock_adjustments_new_stock_nonnegative check (new_stock >= 0),
  constraint stock_adjustments_delta_matches check (delta = new_stock - previous_stock),
  constraint stock_adjustments_reason_length check (char_length(reason) <= 200)
);

create index if not exists stock_adjustments_seller_created_idx
  on public.stock_adjustments (seller_id, created_at desc);

create index if not exists stock_adjustments_product_created_idx
  on public.stock_adjustments (product_id, created_at desc);

alter table public.stock_adjustments enable row level security;

drop policy if exists stock_adjustments_seller_select on public.stock_adjustments;
create policy stock_adjustments_seller_select
on public.stock_adjustments
for select
to authenticated
using (
  seller_id = (select auth.uid())
  and private.is_approved_supplier((select auth.uid()))
);

grant select on public.stock_adjustments to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stock_adjustments'
  ) then
    alter publication supabase_realtime add table public.stock_adjustments;
  end if;
exception
  when duplicate_object then
    null;
end;
$$;
