-- Cash on delivery is owned by SoukCart, not sellers.
-- Delivery partners collect cash and settle with the platform; sellers are paid
-- weekly after commission. Restrict collect_cod_payment to admins and stop
-- counting unpaid COD as seller "needs action".

create or replace function public.collect_cod_payment(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  collected public.orders%rowtype;
begin
  if actor_id is null then
    raise exception 'Sign in to record a cash payment.';
  end if;

  select account.role
  into actor_role
  from public.users as account
  where account.id = actor_id;

  if actor_role is distinct from 'admin' then
    raise exception 'Only SoukCart can record cash on delivery collection.';
  end if;

  update public.orders
  set payment_status = 'paid',
      paid_at = coalesce(paid_at, now())
  where id = p_order_id
    and payment_method = 'cod'
    and payment_status = 'unpaid'
    and status not in ('pending', 'cancelled')
  returning * into collected;

  if collected.id is null then
    raise exception 'This order is not waiting for cash collection.';
  end if;

  insert into public.notifications (recipient_id, order_id, type, title, message)
  values (
    collected.retailer_id,
    collected.id,
    'cod_collected',
    'Cash on delivery collected',
    'Cash was collected for order #' || upper(substr(collected.id::text, 1, 8)) || '. Your invoice is ready.'
  );

  return jsonb_build_object(
    'id', collected.id,
    'paymentStatus', 'paid',
    'paidAt', collected.paid_at
  );
end;
$$;

revoke execute on function public.collect_cod_payment(uuid) from public, anon;
grant execute on function public.collect_cod_payment(uuid) to authenticated;

create or replace function public.seller_nav_badges()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_needs_action integer := 0;
  v_stock_at_risk integer := 0;
begin
  select count(*)::integer
  into v_needs_action
  from public.orders as placed_order
  where exists (
      select 1
      from public.order_items as item
      where item.order_id = placed_order.id
        and item.seller_id = v_seller_id
    )
    and (
      (
        placed_order.cancel_requested
        and placed_order.status is distinct from 'cancelled'
      )
      or (
        not coalesce(placed_order.cancel_requested, false)
        and (
          (
            placed_order.status = 'pending'
            and (
              placed_order.payment_method = 'cod'
              or placed_order.payment_status = 'paid'
            )
          )
          or (
            placed_order.status = 'confirmed'
            and (
              placed_order.payment_method = 'cod'
              or placed_order.payment_status = 'paid'
            )
          )
          or (
            placed_order.status = 'shipped'
            and (
              placed_order.payment_method = 'cod'
              or placed_order.payment_status = 'paid'
            )
          )
        )
      )
    );

  select count(*)::integer
  into v_stock_at_risk
  from public.products as product
  where product.seller_id = v_seller_id
    and product.is_active
    and product.stock <= 5;

  return jsonb_build_object(
    'needsAction', coalesce(v_needs_action, 0),
    'stockAtRisk', coalesce(v_stock_at_risk, 0)
  );
end;
$$;

revoke execute on function public.seller_nav_badges() from public, anon;
grant execute on function public.seller_nav_badges() to authenticated;
