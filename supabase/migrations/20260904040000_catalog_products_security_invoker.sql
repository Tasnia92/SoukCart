-- Recreate the retailer catalog as a security-invoker view so it obeys
-- products_read. Shop names still come from a private helper, because
-- retailers cannot read supplier_profiles or other users' rows.

create or replace function private.supplier_display_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(profile.shop_name), ''), account.name)
  from public.supplier_profiles as profile
  join public.users as account on account.id = profile.user_id
  where profile.user_id = p_user_id
    and profile.status = 'approved'
$$;

revoke all on function private.supplier_display_name(uuid) from public;
grant execute on function private.supplier_display_name(uuid) to authenticated;

drop view if exists public.catalog_products;

create view public.catalog_products
with (security_invoker = true, security_barrier = true)
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
  private.supplier_display_name(product.seller_id) as seller_name
from public.products as product
where product.is_active;

comment on view public.catalog_products is
  'Active listings from approved suppliers, with a public shop name for the retailer catalog.';

revoke all on public.catalog_products from public, anon, authenticated;
grant select on public.catalog_products to authenticated;
