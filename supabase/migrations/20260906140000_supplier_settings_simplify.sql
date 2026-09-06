-- Settings simplification: suppliers receive all notifications (no toggles)
-- and the fulfillment/payouts preference feature is retired. Drop the columns
-- and narrow the update RPC to the shop profile contact fields.

drop function if exists public.update_seller_shop_settings(
  text, text, text, text, text, integer, text, boolean, boolean, boolean
);

alter table public.supplier_profiles
  drop column if exists notify_orders,
  drop column if exists notify_stock,
  drop column if exists notify_payouts,
  drop column if exists delivery_coverage,
  drop column if exists processing_time_hours,
  drop column if exists payout_method;

create or replace function public.update_seller_shop_settings(
  p_shop_name text,
  p_shop_details text,
  p_location text,
  p_contact_phone text
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

  update public.supplier_profiles as profile
  set
    shop_name = v_shop_name,
    shop_details = v_shop_details,
    location = v_location,
    contact_phone = v_contact_phone,
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
    'status', v_row.status,
    'updatedAt', v_row.updated_at
  );
end;
$$;

revoke execute on function public.update_seller_shop_settings(text, text, text, text)
  from public, anon;
grant execute on function public.update_seller_shop_settings(text, text, text, text)
  to authenticated;

comment on function public.update_seller_shop_settings(text, text, text, text) is
  'Approved sellers update their shop profile without touching review-owned columns.';
