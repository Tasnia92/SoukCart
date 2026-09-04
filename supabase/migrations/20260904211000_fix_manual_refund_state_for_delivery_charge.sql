-- Allow non-zero prepaid delivery_charge on open orders.
-- The previous check forced delivery_charge = 0 whenever manual_refund_status
-- was not_required, which blocked create_order_from_cart after prepaid delivery.

alter table public.orders
  drop constraint if exists orders_manual_refund_state_check;

alter table public.orders
  add constraint orders_manual_refund_state_check
  check (
    (
      manual_refund_status = 'not_required'
      and refund_amount = 0
      and refund_completed_at is null
      and refund_completed_by is null
    )
    or (
      manual_refund_status = 'review_required'
      and status = 'cancelled'
      and payment_method = 'online'
      and payment_status = 'paid'
      and refund_amount = 0
      and refund_completed_at is null
      and refund_completed_by is null
    )
    or (
      manual_refund_status = 'pending'
      and status = 'cancelled'
      and refund_amount > 0
      and refund_completed_at is null
      and refund_completed_by is null
      and (
        (payment_method = 'online' and payment_status = 'paid')
        or (payment_method = 'cod' and delivery_payment_status = 'paid')
      )
    )
    or (
      manual_refund_status = 'completed'
      and status = 'cancelled'
      and refund_amount > 0
      and refund_completed_at is not null
      and refund_completed_by is not null
      and (
        (payment_method = 'online' and payment_status = 'paid')
        or (payment_method = 'cod' and delivery_payment_status = 'paid')
      )
    )
  );
