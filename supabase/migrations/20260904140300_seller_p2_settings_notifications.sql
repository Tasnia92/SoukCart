-- P2: Seller shop settings columns + update RPC, and notification helpers.

alter table public.supplier_profiles
  add column if not exists notify_orders boolean not null default true;

alter table public.supplier_profiles
  add column if not exists notify_stock boolean not null default true;

alter table public.supplier_profiles
  add column if not exists notify_payouts boolean not null default true;

alter table public.supplier_profiles
  add column if not exists delivery_coverage text not null default '';

alter table public.supplier_profiles
  add column if not exists processing_time_hours integer not null default 24;

alter table public.supplier_profiles
  add column if not exists payout_method text not null default 'manual';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'supplier_profiles_processing_time_hours_positive'
      and conrelid = 'public.supplier_profiles'::regclass
  ) then
    alter table public.supplier_profiles
      add constraint supplier_profiles_processing_time_hours_positive
      check (processing_time_hours >= 1 and processing_time_hours <= 720);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'supplier_profiles_payout_method_allowed'
      and conrelid = 'public.supplier_profiles'::regclass
  ) then
    alter table public.supplier_profiles
      add constraint supplier_profiles_payout_method_allowed
      check (payout_method in ('manual', 'bank_transfer', 'mobile_wallet'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'supplier_profiles_delivery_coverage_length'
      and conrelid = 'public.supplier_profiles'::regclass
  ) then
    alter table public.supplier_profiles
      add constraint supplier_profiles_delivery_coverage_length
      check (char_length(delivery_coverage) <= 500);
  end if;
end;
$$;

create or replace function public.update_seller_shop_settings(
  p_shop_name text,
  p_shop_details text,
  p_location text,
  p_contact_phone text,
  p_delivery_coverage text default '',
  p_processing_time_hours integer default 24,
  p_payout_method text default 'manual',
  p_notify_orders boolean default true,
  p_notify_stock boolean default true,
  p_notify_payouts boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := private.require_approved_seller();
  v_shop_name text := btrim(coalesce(p_shop_name, ''));
  v_shop_details text := btrim(coalesce(p_shop_details, ''));
  v_location text := btrim(coalesce(p_location, ''));
  v_contact_phone text := btrim(coalesce(p_contact_phone, ''));
  v_delivery_coverage text := btrim(coalesce(p_delivery_coverage, ''));
  v_payout_method text := lower(btrim(coalesce(p_payout_method, 'manual')));
  v_phone_digits text;
  v_row public.supplier_profiles%rowtype;
begin
  if char_length(v_shop_name) < 2 or char_length(v_shop_name) > 120 then
    raise exception 'Enter your shop name (2–120 characters).';
  end if;

  if char_length(v_shop_details) < 10 or char_length(v_shop_details) > 2000 then
    raise exception 'Describe your shop in a little detail (10–2000 characters).';
  end if;

  if char_length(v_location) < 2 or char_length(v_location) > 200 then
    raise exception 'Enter your shop location (2–200 characters).';
  end if;

  v_phone_digits := regexp_replace(v_contact_phone, '[^0-9]', '', 'g');
  if char_length(v_phone_digits) < 10 or char_length(v_phone_digits) > 15 then
    raise exception 'Enter a valid contact phone number.';
  end if;

  if char_length(v_delivery_coverage) > 500 then
    raise exception 'Delivery coverage must be 500 characters or fewer.';
  end if;

  if p_processing_time_hours is null
    or p_processing_time_hours < 1
    or p_processing_time_hours > 720
  then
    raise exception 'Processing time must be between 1 and 720 hours.';
  end if;

  if v_payout_method not in ('manual', 'bank_transfer', 'mobile_wallet') then
    raise exception 'Choose a valid payout method.';
  end if;

  update public.supplier_profiles as profile
  set
    shop_name = v_shop_name,
    shop_details = v_shop_details,
    location = v_location,
    contact_phone = v_contact_phone,
    delivery_coverage = v_delivery_coverage,
    processing_time_hours = p_processing_time_hours,
    payout_method = v_payout_method,
    notify_orders = coalesce(p_notify_orders, true),
    notify_stock = coalesce(p_notify_stock, true),
    notify_payouts = coalesce(p_notify_payouts, true),
    updated_at = now()
  where profile.user_id = v_seller_id
    and profile.status = 'approved'
  returning * into v_row;

  if not found then
    raise exception 'Verified shop profile not found.';
  end if;

  return jsonb_build_object(
    'userId', v_row.user_id,
    'shopName', v_row.shop_name,
    'shopDetails', v_row.shop_details,
    'location', v_row.location,
    'contactPhone', v_row.contact_phone,
    'deliveryCoverage', v_row.delivery_coverage,
    'processingTimeHours', v_row.processing_time_hours,
    'payoutMethod', v_row.payout_method,
    'notifyOrders', v_row.notify_orders,
    'notifyStock', v_row.notify_stock,
    'notifyPayouts', v_row.notify_payouts,
    'status', v_row.status,
    'updatedAt', v_row.updated_at
  );
end;
$$;

revoke execute on function public.update_seller_shop_settings(
  text, text, text, text, text, integer, text, boolean, boolean, boolean
) from public, anon;
grant execute on function public.update_seller_shop_settings(
  text, text, text, text, text, integer, text, boolean, boolean, boolean
) to authenticated;

comment on function public.update_seller_shop_settings(
  text, text, text, text, text, integer, text, boolean, boolean, boolean
) is
  'Approved sellers update shop contact, coverage, payout preference, and notification toggles without touching review-owned columns.';

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Sign in to manage notifications.';
  end if;

  with updated as (
    update public.notifications as note
    set read_at = now()
    where note.recipient_id = v_user_id
      and note.read_at is null
    returning 1
  )
  select count(*)::integer into v_count from updated;

  return coalesce(v_count, 0);
end;
$$;

revoke execute on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

comment on function public.mark_all_notifications_read() is
  'Marks every unread notification for the signed-in user as read.';
