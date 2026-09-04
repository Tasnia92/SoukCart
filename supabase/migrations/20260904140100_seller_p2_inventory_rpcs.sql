-- P2: Stock adjust RPCs + reorder-threshold-aware nav badges / dashboard summary.

create or replace function public.seller_adjust_stock(
  p_product_id uuid,
  p_mode text,
  p_value integer,
  p_expected_version integer,
  p_reason text default '',
  p_reorder_threshold integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_mode text := lower(btrim(coalesce(p_mode, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_product public.products%rowtype;
  v_previous integer;
  v_next integer;
  v_threshold integer;
begin
  if v_mode is distinct from 'absolute' and v_mode is distinct from 'relative' then
    raise exception 'Stock mode must be absolute or relative.';
  end if;

  if p_value is null or (v_mode = 'absolute' and p_value < 0) then
    raise exception 'Stock quantity must be a whole number of 0 or more.';
  end if;

  if char_length(v_reason) > 200 then
    raise exception 'Adjustment reason must be 200 characters or fewer.';
  end if;

  if p_reorder_threshold is not null and p_reorder_threshold < 0 then
    raise exception 'Reorder threshold must be 0 or more.';
  end if;

  select *
  into v_product
  from public.products as product
  where product.id = p_product_id
    and product.seller_id = v_seller_id
  for update;

  if not found then
    raise exception 'Product not found.';
  end if;

  if p_expected_version is distinct from v_product.stock_version then
    raise exception 'Stock changed elsewhere. Refresh and try again.';
  end if;

  v_previous := v_product.stock;
  if v_mode = 'absolute' then
    v_next := p_value;
  else
    v_next := v_previous + p_value;
  end if;

  if v_next < 0 then
    raise exception 'Stock cannot go below 0.';
  end if;

  v_threshold := coalesce(p_reorder_threshold, v_product.reorder_threshold);

  update public.products as product
  set
    stock = v_next,
    stock_version = product.stock_version + 1,
    reorder_threshold = v_threshold
  where product.id = v_product.id;

  insert into public.stock_adjustments (
    product_id,
    seller_id,
    previous_stock,
    new_stock,
    delta,
    reason
  )
  values (
    v_product.id,
    v_seller_id,
    v_previous,
    v_next,
    v_next - v_previous,
    v_reason
  );

  return jsonb_build_object(
    'id', v_product.id,
    'stock', v_next,
    'stockVersion', v_product.stock_version + 1,
    'reorderThreshold', v_threshold,
    'previousStock', v_previous,
    'delta', v_next - v_previous
  );
end;
$$;

revoke execute on function public.seller_adjust_stock(uuid, text, integer, integer, text, integer)
from public, anon;
grant execute on function public.seller_adjust_stock(uuid, text, integer, integer, text, integer)
to authenticated;

comment on function public.seller_adjust_stock(uuid, text, integer, integer, text, integer) is
  'Approved seller stock write with optimistic concurrency, optional reorder threshold update, and adjustment history.';

create or replace function public.seller_bulk_adjust_stock(p_adjustments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_item jsonb;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_mode text;
  v_value integer;
  v_version integer;
  v_product_id uuid;
  v_reason text;
  v_threshold integer;
begin
  if p_adjustments is null or jsonb_typeof(p_adjustments) is distinct from 'array' then
    raise exception 'Adjustments must be a JSON array.';
  end if;

  if jsonb_array_length(p_adjustments) = 0 then
    raise exception 'Provide at least one stock adjustment.';
  end if;

  if jsonb_array_length(p_adjustments) > 200 then
    raise exception 'Bulk stock updates are limited to 200 rows at a time.';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_adjustments)
  loop
    begin
      v_product_id := (v_item ->> 'productId')::uuid;
    exception
      when others then
        raise exception 'Each adjustment needs a valid productId.';
    end;

    v_mode := lower(btrim(coalesce(v_item ->> 'mode', 'absolute')));
    v_value := (v_item ->> 'value')::integer;
    v_version := (v_item ->> 'expectedVersion')::integer;
    v_reason := coalesce(v_item ->> 'reason', '');
    v_threshold := case
      when v_item ? 'reorderThreshold' and nullif(v_item ->> 'reorderThreshold', '') is not null
        then (v_item ->> 'reorderThreshold')::integer
      else null
    end;

    v_result := public.seller_adjust_stock(
      v_product_id,
      v_mode,
      v_value,
      v_version,
      v_reason,
      v_threshold
    );
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object(
    'sellerId', v_seller_id,
    'updated', jsonb_array_length(v_results),
    'results', v_results
  );
end;
$$;

revoke execute on function public.seller_bulk_adjust_stock(jsonb) from public, anon;
grant execute on function public.seller_bulk_adjust_stock(jsonb) to authenticated;

comment on function public.seller_bulk_adjust_stock(jsonb) is
  'Applies up to 200 seller stock adjustments atomically via seller_adjust_stock.';

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
  v_unread_notifications integer := 0;
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
          or (
            placed_order.payment_method = 'cod'
            and placed_order.payment_status = 'unpaid'
            and placed_order.status is distinct from 'cancelled'
            and placed_order.status is distinct from 'pending'
          )
        )
      )
    );

  select count(*)::integer
  into v_stock_at_risk
  from public.products as product
  where product.seller_id = v_seller_id
    and product.is_active
    and product.stock <= product.reorder_threshold;

  select count(*)::integer
  into v_unread_notifications
  from public.notifications as note
  where note.recipient_id = v_seller_id
    and note.read_at is null;

  return jsonb_build_object(
    'needsAction', coalesce(v_needs_action, 0),
    'stockAtRisk', coalesce(v_stock_at_risk, 0),
    'unreadNotifications', coalesce(v_unread_notifications, 0)
  );
end;
$$;

revoke execute on function public.seller_nav_badges() from public, anon;
grant execute on function public.seller_nav_badges() to authenticated;
