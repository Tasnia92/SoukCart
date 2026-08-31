-- Add a payment method to orders so retailers can choose between paying
-- online (SSLCommerz) and Cash on Delivery. COD orders stay "unpaid" until
-- the cash is collected at delivery; they carry no transaction id.

alter table public.orders
  add column if not exists payment_method text not null default 'online'
  check (payment_method in ('online', 'cod'));