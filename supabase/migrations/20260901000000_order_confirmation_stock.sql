-- Stock is committed when an order is accepted (pending -> confirmed/shipped/delivered)
-- and released if it goes back (confirmed/shipped/delivered -> pending/cancelled).
-- A trigger covers every status-change path: seller confirmation, admin updates,
-- and customer cancellation all behave the same way.

create or replace function public.apply_order_stock_delta(p_order_id uuid, p_delta int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  short_product text;
begin
  if p_delta < 0 then
    select p.name into short_product
    from order_items oi
    join products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.stock < oi.quantity
    limit 1;
    if short_product is not null then
      raise exception 'Not enough stock for %. Restock before confirming.', short_product;
    end if;
  end if;

  update products p
  set stock = p.stock + p_delta * oi.quantity
  from order_items oi
  where oi.order_id = p_order_id and oi.product_id = p.id;
end;
$$;

create or replace function public.handle_order_status_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status in ('pending', 'cancelled') and new.status in ('confirmed', 'shipped', 'delivered') then
    perform public.apply_order_stock_delta(new.id, -1);
  elsif old.status in ('confirmed', 'shipped', 'delivered') and new.status in ('pending', 'cancelled') then
    perform public.apply_order_stock_delta(new.id, 1);
  end if;

  return new;
end;
$$;

drop trigger if exists orders_status_stock on public.orders;

create trigger orders_status_stock
after update of status on public.orders
for each row
execute function public.handle_order_status_stock();
