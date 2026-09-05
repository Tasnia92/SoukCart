-- Stock must move when the retailer pays (or starts a live checkout), not when
-- a supplier later confirms. Confirmation only advances fulfillment.
--
-- apply_order_inventory_delta previously ran as the caller. Product RLS can
-- make that UPDATE match zero rows with no error, so an online paid order kept
-- showing the old stock until the supplier confirmed (a SECURITY DEFINER path).

create or replace function public.apply_order_inventory_delta(
  p_order_id uuid,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  short_product text;
  updated_rows integer := 0;
  pending_lines integer := 0;
begin
  if p_delta not in (-1, 1) then
    raise exception 'Inventory delta must be -1 or 1.';
  end if;

  perform product.id
  from public.products as product
  join (
    select item.product_id, sum(item.quantity)::integer as quantity
    from public.order_items as item
    where item.order_id = p_order_id
      and not exists (
        select 1
        from public.order_supplier_acceptances as package
        where package.order_id = item.order_id
          and package.supplier_id is not distinct from item.seller_id
          and package.status = 'declined'
      )
    group by item.product_id
  ) as line on line.product_id = product.id
  order by product.id
  for update of product;

  if p_delta = -1 then
    select product.name
    into short_product
    from public.products as product
    join (
      select item.product_id, sum(item.quantity)::integer as quantity
      from public.order_items as item
      where item.order_id = p_order_id
        and not exists (
          select 1
          from public.order_supplier_acceptances as package
          where package.order_id = item.order_id
            and package.supplier_id is not distinct from item.seller_id
            and package.status = 'declined'
        )
      group by item.product_id
    ) as line on line.product_id = product.id
    where product.stock < line.quantity
    limit 1;

    if short_product is not null then
      raise exception 'Not enough stock for %.', short_product;
    end if;
  end if;

  update public.products as product
  set
    stock = product.stock + (p_delta * line.quantity),
    stock_version = product.stock_version + 1
  from (
    select item.product_id, sum(item.quantity)::integer as quantity
    from public.order_items as item
    where item.order_id = p_order_id
      and not exists (
        select 1
        from public.order_supplier_acceptances as package
        where package.order_id = item.order_id
          and package.supplier_id is not distinct from item.seller_id
          and package.status = 'declined'
      )
    group by item.product_id
  ) as line
  where line.product_id = product.id;

  get diagnostics updated_rows = row_count;

  select count(*)
  into pending_lines
  from public.order_items as item
  where item.order_id = p_order_id
    and not exists (
      select 1
      from public.order_supplier_acceptances as package
      where package.order_id = item.order_id
        and package.supplier_id is not distinct from item.seller_id
        and package.status = 'declined'
    );

  if pending_lines > 0 and updated_rows = 0 then
    raise exception 'Could not update stock for this order.';
  end if;
end;
$$;

revoke execute on function public.apply_order_inventory_delta(uuid, integer)
from public, anon, authenticated;

grant execute on function public.apply_order_inventory_delta(uuid, integer)
to service_role;

create or replace function private.apply_seller_inventory_delta(
  p_order_id uuid,
  p_seller_id uuid,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  short_product text;
begin
  if p_delta not in (-1, 1) then
    raise exception 'Inventory delta must be -1 or 1.';
  end if;

  perform product.id
  from public.products as product
  join (
    select item.product_id, sum(item.quantity)::integer as quantity
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id = p_seller_id
    group by item.product_id
  ) as line on line.product_id = product.id
  order by product.id
  for update of product;

  if p_delta = -1 then
    select product.name
    into short_product
    from public.products as product
    join (
      select item.product_id, sum(item.quantity)::integer as quantity
      from public.order_items as item
      where item.order_id = p_order_id
        and item.seller_id = p_seller_id
      group by item.product_id
    ) as line on line.product_id = product.id
    where product.stock < line.quantity
    limit 1;

    if short_product is not null then
      raise exception 'Not enough stock for %.', short_product;
    end if;
  end if;

  update public.products as product
  set
    stock = product.stock + (p_delta * line.quantity),
    stock_version = product.stock_version + 1
  from (
    select item.product_id, sum(item.quantity)::integer as quantity
    from public.order_items as item
    where item.order_id = p_order_id
      and item.seller_id = p_seller_id
    group by item.product_id
  ) as line
  where line.product_id = product.id;
end;
$$;

create or replace function public.handle_order_inventory_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  should_reserve boolean;
begin
  if old.payment_status = 'paid' and new.payment_status <> 'paid' then
    raise exception 'A paid order payment status cannot be downgraded.';
  end if;

  if new.payment_status = 'paid'
    and old.payment_status is distinct from 'unpaid'
    and old.payment_status is distinct from 'paid'
  then
    raise exception 'This checkout is no longer valid. A leftover or expired payment cannot be captured.';
  end if;

  -- Live checkouts and paid orders own inventory. Supplier confirmation is not
  -- the reservation event: a paid online order must already have stock taken.
  should_reserve := new.status <> 'cancelled'
    and new.payment_status not in ('failed', 'cancelled')
    and new.delivery_payment_status not in ('failed', 'cancelled');

  if old.stock_reserved and not should_reserve then
    perform public.apply_order_inventory_delta(new.id, 1);
    new.stock_reserved := false;
  elsif not old.stock_reserved and should_reserve then
    perform public.apply_order_inventory_delta(new.id, -1);
    new.stock_reserved := true;
  end if;

  return new;
end;
$$;

revoke execute on function public.handle_order_inventory_reservation()
from public, anon, authenticated;

drop trigger if exists orders_inventory_reservation on public.orders;

create trigger orders_inventory_reservation
before update of status, payment_status, delivery_payment_status on public.orders
for each row
execute function public.handle_order_inventory_reservation();
