-- Saved delivery addresses for retailers (multi-address checkout + settings).

create table public.retailer_shipping_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  label text not null default 'Address',
  phone text not null,
  address text not null,
  city text not null,
  postcode text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retailer_shipping_addresses_label_len check (char_length(btrim(label)) between 1 and 80),
  constraint retailer_shipping_addresses_phone_len check (char_length(btrim(phone)) between 5 and 30),
  constraint retailer_shipping_addresses_address_len check (char_length(btrim(address)) between 3 and 300),
  constraint retailer_shipping_addresses_city_len check (char_length(btrim(city)) between 2 and 80),
  constraint retailer_shipping_addresses_postcode_len check (char_length(btrim(postcode)) between 2 and 20)
);

comment on table public.retailer_shipping_addresses is
  'Retailer-owned delivery addresses selectable at checkout.';

create index retailer_shipping_addresses_user_id_idx
  on public.retailer_shipping_addresses (user_id, created_at desc);

-- At most one default address per retailer.
create unique index retailer_shipping_addresses_one_default_idx
  on public.retailer_shipping_addresses (user_id)
  where is_default;

create or replace function public.touch_retailer_shipping_addresses_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger retailer_shipping_addresses_touch_updated_at
before update on public.retailer_shipping_addresses
for each row
execute function public.touch_retailer_shipping_addresses_updated_at();

-- Clear other defaults before write so the partial unique index stays valid.
create or replace function public.retailer_shipping_addresses_enforce_single_default()
returns trigger
language plpgsql
as $$
begin
  if new.is_default then
    update public.retailer_shipping_addresses
    set is_default = false
    where user_id = new.user_id
      and id is distinct from coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and is_default;
  end if;
  return new;
end;
$$;

create trigger retailer_shipping_addresses_single_default
before insert or update of is_default on public.retailer_shipping_addresses
for each row
when (new.is_default)
execute function public.retailer_shipping_addresses_enforce_single_default();

alter table public.retailer_shipping_addresses enable row level security;

create policy retailer_shipping_addresses_select_own
on public.retailer_shipping_addresses
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy retailer_shipping_addresses_insert_own
on public.retailer_shipping_addresses
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.users as profile
    where profile.id = auth.uid()
      and profile.role = 'retailer'
  )
);

create policy retailer_shipping_addresses_update_own
on public.retailer_shipping_addresses
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy retailer_shipping_addresses_delete_own
on public.retailer_shipping_addresses
for delete
to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.retailer_shipping_addresses to authenticated;
