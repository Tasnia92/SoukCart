-- Block order items whose quantity exceeds the product's current stock.
-- This is the server-side guarantee behind the retailer stock limits: an
-- order can never be placed for more units than the seller has available.

create or replace function public.enforce_order_item_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  available integer;
begin
  select stock into available
  from products
  where id = new.product_id;

  if available is null then
    raise exception 'This product is no longer available.';
  end if;

  if new.quantity > available then
    raise exception 'Only % units of this product are in stock.', available;
  end if;

  return new;
end;
$$;

drop trigger if exists order_items_stock_check on public.order_items;

create trigger order_items_stock_check
before insert on public.order_items
for each row
execute function public.enforce_order_item_stock();