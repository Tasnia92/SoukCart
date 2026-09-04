-- Baseline snapshot of core public tables as of 2026-09-04 (hosted project hrtgeupyijugssrckohx).
-- These CREATE statements were missing from the checked-in migration history (hosted versions
-- 20260809180923 / 20260818101054 exist remotely but were not in the repo).
--
-- Purpose: reproducible security review and local drift detection.
-- Do NOT apply blindly on a database that already has these tables.
-- For a greenfield local bootstrap, prefer `supabase db pull` from the linked project,
-- or run this file only on an empty public schema before later migrations.

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default '',
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.users (id) on delete set null,
  name text not null,
  description text not null default '',
  price numeric(12, 2) not null check (price > 0),
  unit text not null default 'piece',
  stock integer not null default 0 check (stock >= 0),
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  category text,
  min_order_qty integer not null default 1 check (min_order_qty >= 1)
);

alter table public.products enable row level security;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'failed', 'cancelled')),
  tran_id text,
  val_id text,
  sessionkey text,
  bank_tran_id text,
  paid_at timestamptz,
  payment_method text not null default 'online'
    check (payment_method in ('online', 'cod')),
  cancel_requested boolean not null default false,
  cancel_requested_at timestamptz,
  stock_reserved boolean not null default false,
  delivered_at timestamptz,
  delivery_verified_at timestamptz,
  delivery_verified_by uuid references public.users (id),
  cancellation_initiator text
    check (
      cancellation_initiator is null
      or cancellation_initiator in ('retailer', 'supplier', 'admin', 'support')
    ),
  cancellation_requested_by uuid references public.users (id),
  cancellation_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.users (id),
  platform_charge numeric(12, 2) not null default 0 check (platform_charge >= 0),
  delivery_charge numeric(12, 2) not null default 0 check (delivery_charge >= 0),
  refund_amount numeric(12, 2) not null default 0 check (refund_amount >= 0),
  manual_refund_status text not null default 'not_required'
    check (manual_refund_status in ('not_required', 'review_required', 'pending', 'completed')),
  refund_completed_at timestamptz,
  refund_completed_by uuid references public.users (id),
  delivery_phone text,
  delivery_address text,
  delivery_city text,
  delivery_postcode text,
  delivery_payment_status text not null default 'unpaid'
    check (delivery_payment_status in ('unpaid', 'paid', 'failed', 'cancelled')),
  delivery_paid_at timestamptz
);

alter table public.orders enable row level security;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  -- Snapshotted at order time (added in seller_p0_auth_integrity_helpers)
  seller_id uuid references public.users (id) on delete set null,
  product_name text not null default 'Product',
  unit text not null default 'piece'
);

alter table public.order_items enable row level security;

-- Policies matching live hosted state after P0 (plus later catalog policies).
-- users
drop policy if exists users_read_own on public.users;
create policy users_read_own
on public.users for select
to authenticated
using (id = auth.uid());

drop policy if exists users_update_own on public.users;
create policy users_update_own
on public.users for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid() and role = any (array['seller'::text, 'retailer'::text]));

-- orders / order_items (retailer read-own; sellers use SECURITY DEFINER RPCs)
drop policy if exists orders_read_own on public.orders;
create policy orders_read_own
on public.orders for select
to authenticated
using (retailer_id = auth.uid());

drop policy if exists order_items_read_own on public.order_items;
create policy order_items_read_own
on public.order_items for select
to authenticated
using (
  exists (
    select 1
    from public.orders as placed_order
    where placed_order.id = order_items.order_id
      and placed_order.retailer_id = auth.uid()
  )
);

-- products: seller CRUD requires approved verification; catalog read uses private.is_approved_supplier
drop policy if exists products_seller_read_all on public.products;
create policy products_seller_read_all
on public.products for select
to authenticated
using (seller_id = auth.uid());

drop policy if exists products_seller_insert on public.products;
create policy products_seller_insert
on public.products for insert
to authenticated
with check (
  seller_id = (select auth.uid())
  and private.is_approved_supplier((select auth.uid()))
);

drop policy if exists products_seller_update on public.products;
create policy products_seller_update
on public.products for update
to authenticated
using (
  seller_id = (select auth.uid())
  and private.is_approved_supplier((select auth.uid()))
)
with check (
  seller_id = (select auth.uid())
  and private.is_approved_supplier((select auth.uid()))
);

drop policy if exists products_seller_delete on public.products;
create policy products_seller_delete
on public.products for delete
to authenticated
using (
  seller_id = (select auth.uid())
  and private.is_approved_supplier((select auth.uid()))
);

-- Note: products_read (catalog) and private.is_approved_supplier are defined in later migrations.
