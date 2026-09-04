-- ---------------------------------------------------------------------------
-- 2. Supplier application submission RPC (no direct seller writes)
-- ---------------------------------------------------------------------------

create or replace function public.submit_supplier_application(
  p_shop_name text,
  p_shop_details text,
  p_location text,
  p_trade_license_number text,
  p_contact_phone text,
  p_nid_front_path text,
  p_nid_back_path text
)
returns public.supplier_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  shop_name text := btrim(coalesce(p_shop_name, ''));
  shop_details text := btrim(coalesce(p_shop_details, ''));
  shop_location text := btrim(coalesce(p_location, ''));
  license_number text := btrim(coalesce(p_trade_license_number, ''));
  contact_phone text := btrim(coalesce(p_contact_phone, ''));
  nid_front text := btrim(coalesce(p_nid_front_path, ''));
  nid_back text := btrim(coalesce(p_nid_back_path, ''));
  previous public.supplier_profiles%rowtype;
  saved public.supplier_profiles%rowtype;
begin
  if actor_id is null or not exists (
    select 1
    from public.users as account
    where account.id = actor_id
      and account.role = 'seller'
  ) then
    raise exception 'A supplier account is required to submit verification.';
  end if;

  if char_length(shop_name) < 2 or char_length(shop_name) > 120 then
    raise exception 'Enter your shop name (2–120 characters).';
  end if;
  if char_length(shop_details) < 10 or char_length(shop_details) > 2000 then
    raise exception 'Describe your shop in a little detail (10–2000 characters).';
  end if;
  if char_length(shop_location) < 2 or char_length(shop_location) > 200 then
    raise exception 'Enter your shop location (2–200 characters).';
  end if;
  if char_length(license_number) < 4 or char_length(license_number) > 60 then
    raise exception 'Enter your trade licence number (4–60 characters).';
  end if;
  if char_length(regexp_replace(contact_phone, '\D', '', 'g')) < 10
    or char_length(regexp_replace(contact_phone, '\D', '', 'g')) > 15
  then
    raise exception 'Enter a valid contact phone number.';
  end if;

  if not private.is_owner_storage_path(actor_id, nid_front) then
    raise exception 'NID card front must be uploaded under your account folder.';
  end if;
  if not private.is_owner_storage_path(actor_id, nid_back) then
    raise exception 'NID card back must be uploaded under your account folder.';
  end if;

  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'trade-licenses'
      and object.name = nid_front
  ) then
    raise exception 'NID card front upload was not found. Upload the file again.';
  end if;
  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'trade-licenses'
      and object.name = nid_back
  ) then
    raise exception 'NID card back upload was not found. Upload the file again.';
  end if;

  select *
  into previous
  from public.supplier_profiles
  where user_id = actor_id
  for update;

  if previous.user_id is not null and previous.status = 'approved' then
    raise exception 'Your shop is already verified.';
  end if;

  insert into public.supplier_profiles (
    user_id,
    shop_name,
    shop_details,
    location,
    trade_license_number,
    nid_front_path,
    nid_back_path,
    contact_phone,
    status,
    review_note,
    reviewed_by,
    reviewed_at
  )
  values (
    actor_id,
    shop_name,
    shop_details,
    shop_location,
    license_number,
    nid_front,
    nid_back,
    contact_phone,
    'pending',
    null,
    null,
    null
  )
  on conflict (user_id) do update
    set shop_name = excluded.shop_name,
        shop_details = excluded.shop_details,
        location = excluded.location,
        trade_license_number = excluded.trade_license_number,
        nid_front_path = excluded.nid_front_path,
        nid_back_path = excluded.nid_back_path,
        contact_phone = excluded.contact_phone,
        status = 'pending',
        review_note = null,
        reviewed_by = null,
        reviewed_at = null,
        updated_at = now()
  returning * into saved;

  -- Clean up replaced NID objects (keep newly referenced paths).
  if previous.user_id is not null then
    if previous.nid_front_path <> ''
      and previous.nid_front_path is distinct from saved.nid_front_path
      and previous.nid_front_path is distinct from saved.nid_back_path
    then
      delete from storage.objects
      where bucket_id = 'trade-licenses'
        and name = previous.nid_front_path
        and (storage.foldername(name))[1] = actor_id::text;
    end if;

    if previous.nid_back_path <> ''
      and previous.nid_back_path is distinct from saved.nid_back_path
      and previous.nid_back_path is distinct from saved.nid_front_path
    then
      delete from storage.objects
      where bucket_id = 'trade-licenses'
        and name = previous.nid_back_path
        and (storage.foldername(name))[1] = actor_id::text;
    end if;
  end if;

  return saved;
end;
$$;

revoke execute on function public.submit_supplier_application(text, text, text, text, text, text, text)
from public, anon;

grant execute on function public.submit_supplier_application(text, text, text, text, text, text, text)
to authenticated;

comment on function public.submit_supplier_application(text, text, text, text, text, text, text) is
  'Seller-only verification submission. Validates NID ownership, resets review fields, and replaces profile rows without exposing review-owned columns to clients.';

drop policy if exists supplier_profiles_insert_own on public.supplier_profiles;
drop policy if exists supplier_profiles_update_own on public.supplier_profiles;

-- ---------------------------------------------------------------------------
-- 1. Product write policies require approved verification
-- ---------------------------------------------------------------------------

drop policy if exists products_seller_insert on public.products;
create policy products_seller_insert
on public.products
for insert
to authenticated
with check (
  seller_id = (select auth.uid())
  and private.is_approved_supplier((select auth.uid()))
);

drop policy if exists products_seller_update on public.products;
create policy products_seller_update
on public.products
for update
to authenticated
using (
  seller_id = (select auth.uid())
  and private.is_approved_supplier((select auth.uid()))
)
with check (
  seller_id = (select auth.uid())
  and private.is_approved_supplier((select auth.uid()))
);

drop policy if exists products_seller_delete on public.products;
create policy products_seller_delete
on public.products
for delete
to authenticated
using (
  seller_id = (select auth.uid())
  and private.is_approved_supplier((select auth.uid()))
);

