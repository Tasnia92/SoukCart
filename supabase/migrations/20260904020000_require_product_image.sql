-- New products must include a photo. Existing listings without an image stay
-- valid so stock and order updates are not blocked; the supplier form still
-- requires a photo when creating or replacing a listing.

create or replace function public.enforce_supplier_product_values()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.price is null or new.price <= 0 then
    raise exception 'Product price must be greater than zero.';
  end if;

  if new.min_order_qty is null or new.min_order_qty < 1 then
    raise exception 'Minimum order quantity must be at least 1.';
  end if;

  if tg_op = 'INSERT' and new.stock < 1 then
    raise exception 'A new product must have at least one unit in stock.';
  end if;

  if tg_op = 'INSERT' and new.stock < new.min_order_qty then
    raise exception 'A new product must have at least the minimum order quantity in stock.';
  end if;

  if tg_op = 'INSERT' and (new.image_url is null or btrim(new.image_url) = '') then
    raise exception 'A product image is required.';
  end if;

  if tg_op = 'UPDATE'
    and new.stock is distinct from old.stock
    and (select auth.uid()) is not null
    and (select auth.uid()) = old.seller_id
    and new.stock < 0
  then
    raise exception 'Supplier stock cannot be negative.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_supplier_product_values()
from public, anon, authenticated;
