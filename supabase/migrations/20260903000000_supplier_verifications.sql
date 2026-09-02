-- Supplier verification.
--
-- A seller signs up with name + email, then must submit shop details and a
-- trade licence. The submission stays `pending` until an admin approves or
-- rejects it. Everything about a seller's application lives in one row keyed by
-- the seller's user id, so the app can gate the supplier workspace on status.

create table public.supplier_profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  shop_name text not null,
  shop_details text not null default '',
  location text not null,
  -- Object path inside the private `trade-licenses` bucket, not a public URL.
  trade_license_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.supplier_profiles is
  'Supplier onboarding + admin verification state, one row per seller.';

-- Admin review dashboards page through pending applications first, newest last.
create index supplier_profiles_status_created_idx
on public.supplier_profiles (status, created_at desc);

alter table public.supplier_profiles enable row level security;

-- A seller can only ever see and manage their own application.
create policy supplier_profiles_read_own
on public.supplier_profiles for select
to authenticated
using (user_id = auth.uid());

-- New submissions always start pending and belong to the caller.
create policy supplier_profiles_insert_own
on public.supplier_profiles for insert
to authenticated
with check (user_id = auth.uid() and status = 'pending');

-- Sellers may edit an application that has not been approved yet (i.e. still
-- pending, or resubmitting after a rejection). Approvals/rejections only happen
-- through the admin service (service role bypasses RLS), so the seller side can
-- only ever move the row back to `pending`.
create policy supplier_profiles_update_own
on public.supplier_profiles for update
to authenticated
using (user_id = auth.uid() and status in ('pending', 'rejected'))
with check (user_id = auth.uid() and status = 'pending');

-- Keep updated_at accurate on every edit.
create or replace function public.touch_supplier_profiles_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger supplier_profiles_touch_updated_at
before update on public.supplier_profiles
for each row execute function public.touch_supplier_profiles_updated_at();

-- Private bucket for trade licences, stored under "<auth.uid()>/<uuid>.<ext>".
-- Trade licences are sensitive documents, so unlike product images this bucket
-- is NOT public; admins view them through short-lived signed URLs minted by the
-- admin-supplier-verifications edge function (service role).
insert into storage.buckets (id, name, public)
values ('trade-licenses', 'trade-licenses', false)
on conflict (id) do nothing;

-- A seller may read, upload, and replace files only inside their own folder.
create policy trade_licenses_owner_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'trade-licenses'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy trade_licenses_owner_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'trade-licenses'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy trade_licenses_owner_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'trade-licenses'
  and (storage.foldername(name))[1] = auth.uid()::text
);
