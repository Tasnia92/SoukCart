-- P0: seller authorization + data integrity
-- 1. Require approved verification for seller RPCs and product writes
-- 2. Submission RPC; revoke direct seller writes to supplier_profiles
-- 3. Validate NID paths + trade-licenses MIME/size limits + replace cleanup
-- 4. Align collect_cod_payment with UI (no pending) + multi-supplier guard
-- 5. Snapshot seller_id / product_name / unit onto order_items

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.is_approved_supplier(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.supplier_profiles as profile
    where profile.user_id = p_user_id
      and profile.status = 'approved'
  );
$$;

revoke all on function private.is_approved_supplier(uuid) from public;
grant execute on function private.is_approved_supplier(uuid) to authenticated, service_role;

create or replace function private.require_approved_seller()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not exists (
    select 1
    from public.users as account
    where account.id = actor_id
      and account.role = 'seller'
  ) then
    raise exception 'A supplier account is required.';
  end if;

  if not private.is_approved_supplier(actor_id) then
    raise exception 'Your shop must be verified before you can manage supplier operations.';
  end if;

  return actor_id;
end;
$$;

revoke all on function private.require_approved_seller() from public;
grant execute on function private.require_approved_seller() to authenticated, service_role;

create or replace function private.is_owner_storage_path(p_user_id uuid, p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_user_id is not null
    and p_path is not null
    and btrim(p_path) <> ''
    and position('/' in btrim(p_path)) > 1
    and split_part(btrim(p_path), '/', 1) = p_user_id::text
    and btrim(p_path) !~ '\.\.'
    and btrim(p_path) !~ '[\\]';
$$;

revoke all on function private.is_owner_storage_path(uuid, text) from public;
grant execute on function private.is_owner_storage_path(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Order-item snapshots (before rewriting RPCs that depend on them)
-- ---------------------------------------------------------------------------

alter table public.order_items
  add column if not exists seller_id uuid references public.users (id) on delete set null,
  add column if not exists product_name text,
  add column if not exists unit text;

update public.order_items as item
set
  seller_id = coalesce(item.seller_id, product.seller_id),
  product_name = coalesce(nullif(btrim(item.product_name), ''), product.name, 'Product'),
  unit = coalesce(nullif(btrim(item.unit), ''), product.unit, 'piece')
from public.products as product
where product.id = item.product_id
  and (
    item.seller_id is null
    or item.product_name is null
    or btrim(item.product_name) = ''
    or item.unit is null
    or btrim(item.unit) = ''
  );

update public.order_items
set
  product_name = coalesce(nullif(btrim(product_name), ''), 'Product'),
  unit = coalesce(nullif(btrim(unit), ''), 'piece')
where product_name is null
   or btrim(product_name) = ''
   or unit is null
   or btrim(unit) = '';

alter table public.order_items
  alter column product_name set default 'Product',
  alter column unit set default 'piece';

alter table public.order_items
  alter column product_name set not null,
  alter column unit set not null;

create index if not exists order_items_seller_id_idx
  on public.order_items (seller_id);

create index if not exists order_items_order_seller_idx
  on public.order_items (order_id, seller_id);

comment on column public.order_items.seller_id is
  'Seller who owned the listing when the order was placed. Prefer over live products.seller_id for history.';
comment on column public.order_items.product_name is
  'Product display name captured at order time.';
comment on column public.order_items.unit is
  'Product unit captured at order time.';

-- ---------------------------------------------------------------------------
-- 3. Trade-license bucket MIME + size
-- ---------------------------------------------------------------------------

update storage.buckets
set
  file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
where id = 'trade-licenses';

