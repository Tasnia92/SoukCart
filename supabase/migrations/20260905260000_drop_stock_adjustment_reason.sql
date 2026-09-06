-- Remove the stock-adjustment reason: no screen sets or displays it anymore.
-- The adjustment history keeps the stock numbers, delta, and timestamps.

alter table public.stock_adjustments
  drop constraint if exists stock_adjustments_reason_length;

alter table public.stock_adjustments
  drop column if exists reason;

-- seller_adjust_stock: drop the five-argument overload that carried the reason
-- and recreate the stock write without it.
drop function if exists public.seller_adjust_stock(uuid, text, integer, integer, text);

create or replace function public.seller_adjust_stock(
  p_product_id uuid,
  p_mode text,
  p_value integer,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_mode text := lower(btrim(coalesce(p_mode, '')));
  v_product public.products%rowtype;
  v_previous integer;
  v_next integer;
begin
  if v_mode is distinct from 'absolute' and v_mode is distinct from 'relative' then
    raise exception 'Stock mode must be absolute or relative.';
  end if;

  if p_value is null or (v_mode = 'absolute' and p_value < 0) then
    raise exception 'Stock quantity must be a whole number of 0 or more.';
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

  update public.products as product
  set
    stock = v_next,
    stock_version = product.stock_version + 1
  where product.id = v_product.id;

  insert into public.stock_adjustments (
    product_id,
    seller_id,
    previous_stock,
    new_stock,
    delta
  )
  values (
    v_product.id,
    v_seller_id,
    v_previous,
    v_next,
    v_next - v_previous
  );

  return jsonb_build_object(
    'id', v_product.id,
    'stock', v_next,
    'stockVersion', v_product.stock_version + 1,
    'previousStock', v_previous,
    'delta', v_next - v_previous
  );
end;
$$;

revoke execute on function public.seller_adjust_stock(uuid, text, integer, integer)
from public, anon;
grant execute on function public.seller_adjust_stock(uuid, text, integer, integer)
to authenticated;

comment on function public.seller_adjust_stock(uuid, text, integer, integer) is
  'Approved seller stock write with optimistic concurrency and adjustment history.';

-- Bulk RPC: adjustments no longer carry a reason.
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

    v_result := public.seller_adjust_stock(
      v_product_id,
      v_mode,
      v_value,
      v_version
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
