-- Supplier order fulfillment: suppliers see orders containing their products
-- and drive the pending -> confirmed -> shipped transitions for them.

create or replace function public.supplier_orders()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(o)), '[]'::json)
  from (
    select
      ord.id,
      ord.status,
      ord.cancel_requested,
      ord.payment_status,
      ord.payment_method,
      ord.notes,
      ord.created_at,
      u.name as retailer_name,
      u.email as retailer_email,
      (
        select json_agg(json_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'product_name', p.name,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'line_total', oi.quantity * oi.unit_price
        ) order by p.name)
        from order_items oi
        join products p on p.id = oi.product_id
        where oi.order_id = ord.id and p.seller_id = auth.uid()
      ) as items,
      (
        select coalesce(sum(oi.quantity * oi.unit_price), 0)
        from order_items oi
        join products p on p.id = oi.product_id
        where oi.order_id = ord.id and p.seller_id = auth.uid()
      ) as supplier_total
    from orders ord
    join users u on u.id = ord.retailer_id
    where exists (
      select 1
      from order_items oi
      join products p on p.id = oi.product_id
      where oi.order_id = ord.id and p.seller_id = auth.uid()
    )
    order by ord.created_at desc
  ) o;
$$;

create or replace function public.seller_set_order_status(p_order_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
  supplies_order boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage your orders.';
  end if;

  if p_status not in ('confirmed', 'shipped') then
    raise exception 'Suppliers can only confirm or ship orders.';
  end if;

  select exists (
    select 1
    from order_items oi
    join products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.seller_id = auth.uid()
  ) into supplies_order;

  if not supplies_order then
    raise exception 'Order not found.';
  end if;

  select status into current_status from orders where id = p_order_id;

  if p_status = 'confirmed' and current_status = 'pending' then
    update orders set status = 'confirmed' where id = p_order_id;
    return 'confirmed';
  elsif p_status = 'shipped' and current_status = 'confirmed' then
    update orders set status = 'shipped' where id = p_order_id;
    return 'shipped';
  else
    raise exception 'This order is no longer in a status that allows that change.';
  end if;
end;
$$;

revoke execute on function public.supplier_orders() from anon;
revoke execute on function public.seller_set_order_status(uuid, text) from anon;
