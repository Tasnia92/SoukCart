-- Retailer complaints reviewed by admins.
create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.users (id) on delete cascade,
  subject text not null,
  description text not null default '',
  attachment_url text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);

-- Retailers may file and read their own complaints.
create policy complaints_insert_own
on public.complaints for insert
to authenticated
with check (retailer_id = auth.uid());

create policy complaints_read_own
on public.complaints for select
to authenticated
using (retailer_id = auth.uid());

-- Public bucket for complaint attachments under "<uid>/<uuid>.<ext>".
insert into storage.buckets (id, name, public)
values ('complaint-files', 'complaint-files', true)
on conflict (id) do nothing;

create policy complaint_files_public_read
on storage.objects for select
using (bucket_id = 'complaint-files');

create policy complaint_files_owner_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'complaint-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy complaint_files_owner_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'complaint-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);