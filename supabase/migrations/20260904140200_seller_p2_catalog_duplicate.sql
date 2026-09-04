-- P2: Duplicate a seller product (hidden copy) without downloading the catalog.

create or replace function public.seller_duplicate_product(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_source public.products%rowtype;
  v_copy_id uuid;
  v_copy_name text;
begin
  select *
  into v_source
  from public.products as product
  where product.id = p_product_id
    and product.seller_id = v_seller_id;

  if not found then
    raise exception 'Product not found.';
  end if;

  v_copy_name := left(btrim(v_source.name) || ' (copy)', 200);

  insert into public.products (
    seller_id,
    name,
    description,
    price,
    unit,
    stock,
    min_order_qty,
    category,
    image_url,
    is_active,
    reorder_threshold,
    stock_version
  )
  values (
    v_seller_id,
    v_copy_name,
    v_source.description,
    v_source.price,
    v_source.unit,
    v_source.stock,
    v_source.min_order_qty,
    v_source.category,
    v_source.image_url,
    false,
    v_source.reorder_threshold,
    0
  )
  returning id into v_copy_id;

  return jsonb_build_object(
    'id', v_copy_id,
    'name', v_copy_name,
    'isActive', false,
    'sourceId', v_source.id
  );
end;
$$;

revoke execute on function public.seller_duplicate_product(uuid) from public, anon;
grant execute on function public.seller_duplicate_product(uuid) to authenticated;

comment on function public.seller_duplicate_product(uuid) is
  'Creates a hidden copy of an approved seller product for quick catalog duplication.';
