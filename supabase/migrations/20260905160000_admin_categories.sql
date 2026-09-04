-- Admin-managed product categories. Products still store `category` as free text,
-- so the admin edge function keeps renames/deletes in sync with product values.

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Category names are unique regardless of case or surrounding whitespace.
create unique index if not exists categories_name_unique
  on public.categories (lower(btrim(name)));

alter table public.categories enable row level security;

-- Suppliers, retailers and admins read the list in the browser; all writes go
-- through the `admin-categories` edge function with a service-role client.
create policy categories_read_authenticated
  on public.categories
  for select
  to authenticated
  using (true);

create or replace function public.set_categories_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
  before update on public.categories
  for each row
  execute function public.set_categories_updated_at();

-- Only the trigger mechanism needs this function; lock it down from direct RPC.
revoke execute on function public.set_categories_updated_at()
from public, anon, authenticated;

-- Product counts per category text value for the admin list. Locked down to the
-- service role so only edge functions can call it.
create or replace function public.category_product_counts()
returns table (category text, product_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.category, count(*)::bigint
  from public.products p
  where p.category is not null
  group by p.category
$$;

revoke execute on function public.category_product_counts()
from public, anon, authenticated;
grant execute on function public.category_product_counts() to service_role;

comment on table public.categories is
  'Admin-managed product categories shown in the supplier form and admin back office.';
comment on function public.category_product_counts() is
  'Product counts per category text value; service-role only (edge functions).';

-- Seed the curated list sellers could previously pick from.
insert into public.categories (name, sort_order)
values
  ('Rice & Grains', 10),
  ('Pulses & Lentils', 20),
  ('Oils & Ghee', 30),
  ('Vegetables', 40),
  ('Fruits', 50),
  ('Dairy & Eggs', 60),
  ('Meat & Fish', 70),
  ('Spices', 80),
  ('Snacks & Drinks', 90),
  ('Bakery & Sweets', 100),
  ('Household', 110),
  ('Other', 1000)
on conflict do nothing;
