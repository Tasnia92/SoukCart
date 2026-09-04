-- Retailers could not see the catalog. products_read checks supplier_profiles
-- for an approved shop, but that table only allows a seller to read their own
-- row, so the EXISTS always failed for everyone else. Look up approval through
-- a private security-definer helper instead of opening verification documents.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

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
grant execute on function private.is_approved_supplier(uuid) to authenticated;

comment on function private.is_approved_supplier(uuid) is
  'True when the user has an approved supplier profile. Used by catalog RLS so retailers can see listings without reading verification documents.';

drop policy if exists products_read on public.products;

create policy products_read
on public.products
for select
to authenticated
using (
  is_active
  and seller_id is not null
  and private.is_approved_supplier(seller_id)
);

-- Shop names live on supplier_profiles, which retailers cannot read. This
-- barrier view is the catalog-safe projection: active listings from approved
-- shops, with a display name and none of the verification documents.
create or replace view public.catalog_products
with (security_invoker = false, security_barrier = true)
as
select
  product.id,
  product.name,
  product.description,
  product.price,
  product.unit,
  product.stock,
  product.min_order_qty,
  product.category,
  product.image_url,
  product.seller_id,
  coalesce(nullif(btrim(profile.shop_name), ''), account.name) as seller_name
from public.products as product
join public.supplier_profiles as profile
  on profile.user_id = product.seller_id
 and profile.status = 'approved'
join public.users as account
  on account.id = product.seller_id
where product.is_active;

comment on view public.catalog_products is
  'Active listings from approved suppliers, with a public shop name for the retailer catalog.';

revoke all on public.catalog_products from public, anon, authenticated;
grant select on public.catalog_products to authenticated;
