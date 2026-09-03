-- Allow sellers to mark a product as out of stock (stock = 0).
--
-- Previously a supplier stock update was rejected below 1 unit, so a seller who
-- sold out could not represent "out of stock" and had to hide the listing
-- instead. This relaxes the supplier guard to reject only negative stock, while
-- keeping two invariants:
--   * a brand-new product must still start with at least one unit (INSERT), and
--   * stock can never go negative.
-- Order-driven decrements run under service_role (auth.uid() is null) and are
-- unaffected by the supplier branch; apply_order_inventory_delta continues to
-- prevent overselling.

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

  if tg_op = 'INSERT' and new.stock < 1 then
    raise exception 'A new product must have at least one unit in stock.';
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
