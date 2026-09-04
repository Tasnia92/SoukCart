-- Hosted project drifted: prepaid-delivery checkout returns payableNow, but
-- order_gateway_amount / capture_gateway_payment / fail_gateway_payment were
-- never applied. Without them, SSLCommerz still charged merchandise only and
-- could not mark delivery paid on capture.

create or replace function public.order_gateway_amount(p_order_id uuid)
returns numeric
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  placed_order public.orders%rowtype;
  merchandise numeric(12, 2);
begin
  select *
  into placed_order
  from public.orders
  where id = p_order_id;

  if placed_order.id is null then
    return 0;
  end if;

  merchandise := public.order_merchandise_total(p_order_id);

  if placed_order.payment_method = 'cod' then
    return round(coalesce(placed_order.delivery_charge, 0), 2);
  end if;

  return round(merchandise + coalesce(placed_order.delivery_charge, 0), 2);
end;
$$;

revoke execute on function public.order_gateway_amount(uuid) from public, anon;
grant execute on function public.order_gateway_amount(uuid) to authenticated, service_role;

create or replace function public.capture_gateway_payment(
  p_order_id uuid,
  p_amount numeric,
  p_val_id text default null,
  p_bank_tran_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  placed_order public.orders%rowtype;
  expected numeric(12, 2);
  now_ts timestamptz := now();
begin
  select *
  into placed_order
  from public.orders
  where id = p_order_id
  for update;

  if placed_order.id is null then
    raise exception 'Order not found.';
  end if;

  expected := public.order_gateway_amount(p_order_id);
  if round(coalesce(p_amount, -1), 2) is distinct from expected then
    raise exception 'Payment amount does not match the order total.';
  end if;

  if placed_order.payment_method = 'online' then
    if placed_order.payment_status = 'paid'
      and placed_order.delivery_payment_status = 'paid'
    then
      return jsonb_build_object(
        'orderId', placed_order.id,
        'paymentStatus', 'paid',
        'deliveryPaymentStatus', 'paid',
        'alreadyCaptured', true
      );
    end if;

    if placed_order.payment_status is distinct from 'unpaid' then
      raise exception 'This checkout is no longer valid. If money was taken, contact support for a refund.';
    end if;

    update public.orders
    set payment_status = 'paid',
        delivery_payment_status = 'paid',
        paid_at = coalesce(paid_at, now_ts),
        delivery_paid_at = coalesce(delivery_paid_at, now_ts),
        val_id = coalesce(nullif(btrim(coalesce(p_val_id, '')), ''), val_id),
        bank_tran_id = coalesce(nullif(btrim(coalesce(p_bank_tran_id, '')), ''), bank_tran_id)
    where id = p_order_id;

    return jsonb_build_object(
      'orderId', p_order_id,
      'paymentStatus', 'paid',
      'deliveryPaymentStatus', 'paid',
      'alreadyCaptured', false
    );
  end if;

  if placed_order.delivery_payment_status = 'paid' then
    return jsonb_build_object(
      'orderId', placed_order.id,
      'paymentStatus', placed_order.payment_status,
      'deliveryPaymentStatus', 'paid',
      'alreadyCaptured', true
    );
  end if;

  if placed_order.delivery_payment_status is distinct from 'unpaid'
    or placed_order.payment_status in ('failed', 'cancelled')
    or placed_order.status = 'cancelled'
  then
    raise exception 'This checkout is no longer valid. If money was taken, contact support for a refund.';
  end if;

  update public.orders
  set delivery_payment_status = 'paid',
      delivery_paid_at = coalesce(delivery_paid_at, now_ts),
      val_id = coalesce(nullif(btrim(coalesce(p_val_id, '')), ''), val_id),
      bank_tran_id = coalesce(nullif(btrim(coalesce(p_bank_tran_id, '')), ''), bank_tran_id)
  where id = p_order_id;

  return jsonb_build_object(
    'orderId', p_order_id,
    'paymentStatus', placed_order.payment_status,
    'deliveryPaymentStatus', 'paid',
    'alreadyCaptured', false
  );
end;
$$;

revoke execute on function public.capture_gateway_payment(uuid, numeric, text, text)
from public, anon, authenticated;
grant execute on function public.capture_gateway_payment(uuid, numeric, text, text)
to service_role;

create or replace function public.fail_gateway_payment(
  p_order_id uuid,
  p_status text default 'failed',
  p_val_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  placed_order public.orders%rowtype;
  next_status text := case when p_status = 'cancelled' then 'cancelled' else 'failed' end;
begin
  select *
  into placed_order
  from public.orders
  where id = p_order_id
  for update;

  if placed_order.id is null then
    raise exception 'Order not found.';
  end if;

  if placed_order.payment_method = 'online' then
    if placed_order.payment_status = 'paid' then
      return jsonb_build_object(
        'orderId', placed_order.id,
        'paymentStatus', 'paid',
        'deliveryPaymentStatus', placed_order.delivery_payment_status
      );
    end if;
    if placed_order.payment_status is distinct from 'unpaid' then
      return jsonb_build_object(
        'orderId', placed_order.id,
        'paymentStatus', placed_order.payment_status,
        'deliveryPaymentStatus', placed_order.delivery_payment_status
      );
    end if;

    update public.orders
    set payment_status = next_status,
        delivery_payment_status = next_status,
        val_id = coalesce(nullif(btrim(coalesce(p_val_id, '')), ''), val_id)
    where id = p_order_id;

    return jsonb_build_object(
      'orderId', p_order_id,
      'paymentStatus', next_status,
      'deliveryPaymentStatus', next_status
    );
  end if;

  if placed_order.delivery_payment_status = 'paid' then
    return jsonb_build_object(
      'orderId', placed_order.id,
      'paymentStatus', placed_order.payment_status,
      'deliveryPaymentStatus', 'paid'
    );
  end if;

  if placed_order.delivery_payment_status is distinct from 'unpaid' then
    return jsonb_build_object(
      'orderId', placed_order.id,
      'paymentStatus', placed_order.payment_status,
      'deliveryPaymentStatus', placed_order.delivery_payment_status
    );
  end if;

  update public.orders
  set payment_status = next_status,
      delivery_payment_status = next_status,
      val_id = coalesce(nullif(btrim(coalesce(p_val_id, '')), ''), val_id)
  where id = p_order_id;

  return jsonb_build_object(
    'orderId', p_order_id,
    'paymentStatus', next_status,
    'deliveryPaymentStatus', next_status
  );
end;
$$;

revoke execute on function public.fail_gateway_payment(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.fail_gateway_payment(uuid, text, text)
to service_role;

create or replace function public.handle_order_inventory_reservation()
returns trigger
language plpgsql
security invoker
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

create or replace function public.expire_stale_unpaid_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_gateway integer := 0;
  expired_cod integer := 0;
begin
  with expired as (
    update public.orders
    set payment_status = 'failed',
        delivery_payment_status = case
          when delivery_payment_status = 'paid' then delivery_payment_status
          else 'failed'
        end
    where status <> 'cancelled'
      and stock_reserved = true
      and created_at < now() - interval '30 minutes'
      and (
        (
          payment_method = 'online'
          and payment_status = 'unpaid'
        )
        or (
          payment_method = 'cod'
          and delivery_payment_status = 'unpaid'
          and payment_status = 'unpaid'
        )
      )
    returning id
  )
  select count(*) into expired_gateway from expired;

  with expired as (
    update public.orders
    set status = 'cancelled',
        cancelled_at = now(),
        cancellation_initiator = 'admin',
        cancellation_reason = 'COD order expired before confirmation.',
        manual_refund_status = case
          when delivery_payment_status = 'paid' and delivery_charge > 0 then 'pending'
          else manual_refund_status
        end,
        refund_amount = case
          when delivery_payment_status = 'paid' and delivery_charge > 0 then delivery_charge
          else refund_amount
        end
    where payment_method = 'cod'
      and delivery_payment_status = 'paid'
      and payment_status = 'unpaid'
      and status = 'pending'
      and created_at < now() - interval '24 hours'
    returning id
  )
  select count(*) into expired_cod from expired;

  return expired_gateway + expired_cod;
end;
$$;
