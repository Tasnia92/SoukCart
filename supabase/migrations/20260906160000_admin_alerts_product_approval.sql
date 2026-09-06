-- Admin alerts + supplier product approval.
--
-- 1. The admin bell never received supplier-verification or dispute alerts:
--    the complaints trigger only fired for cancellation/refund support, and
--    nothing watched supplier_profiles. Both now notify every admin.
-- 2. New supplier listings start `pending` and stay invisible to retailers
--    until an administrator approves them (or rejects with a reason). Editing
--    a rejected listing resubmits it for review.

-- ---------------------------------------------------------------------------
-- 1a. Disputes: notify admins for every new complaint, not just refunds.
-- ---------------------------------------------------------------------------

create or replace function public.notify_admins_of_complaint()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category = 'cancellation_refund' and new.order_id is not null then
    insert into public.notifications (recipient_id, order_id, type, title, message)
    select account.id,
      new.order_id,
      'order_support_requested',
      'Cancellation and refund support requested',
      'A retailer contacted support about verified order #' || upper(substr(new.order_id::text, 1, 8)) || '.'
    from public.users as account
    where account.role = 'admin';
  else
    insert into public.notifications (recipient_id, type, title, message)
    select account.id,
      'dispute_filed',
      'New dispute filed',
      'A retailer opened the dispute "' || left(new.subject, 120) || '". Review it in Disputes.'
    from public.users as account
    where account.role = 'admin';
  end if;

  return new;
end;
$$;

revoke execute on function public.notify_admins_of_complaint()
from public, anon, authenticated;

drop trigger if exists complaints_notify_order_support on public.complaints;
create trigger complaints_notify_admins
after insert on public.complaints
for each row
execute function public.notify_admins_of_complaint();

drop function if exists public.notify_admins_of_order_support_request();

-- ---------------------------------------------------------------------------
-- 1b. Supplier verifications: notify admins of new and resubmitted
--     applications waiting for review.
-- ---------------------------------------------------------------------------

create or replace function public.notify_admins_of_verification_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending'
    and (
      tg_op = 'INSERT'
      or old.status is distinct from 'pending'
    )
  then
    insert into public.notifications (recipient_id, type, title, message)
    select account.id,
      'verification_submitted',
      'Supplier verification needs review',
      '"' || left(new.shop_name, 120) || '" submitted verification documents and is waiting for a decision.'
    from public.users as account
    where account.role = 'admin';
  end if;

  return new;
end;
$$;

revoke execute on function public.notify_admins_of_verification_submission()
from public, anon, authenticated;

drop trigger if exists supplier_profiles_notify_admin_submission on public.supplier_profiles;
create trigger supplier_profiles_notify_admin_submission
after insert or update on public.supplier_profiles
for each row
execute function public.notify_admins_of_verification_submission();

-- ---------------------------------------------------------------------------
-- 2. Product approval workflow.
-- ---------------------------------------------------------------------------

alter table public.products
  add column if not exists approval_status text not null default 'pending',
  add column if not exists approval_note text,
  add column if not exists approved_by uuid references public.users (id) on delete set null,
  add column if not exists approved_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_approval_status_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_approval_status_check
      check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
end;
$$;

-- Listings that predate review are grandfathered in as approved.
update public.products
set approval_status = 'approved'
where approval_status <> 'approved';

comment on column public.products.approval_status is
  'pending = awaiting admin review (invisible to retailers); approved = listed; rejected = admin declined with a note in approval_note.';

comment on column public.products.approval_note is
  'Admin note sent to the supplier when a listing is rejected.';

create index if not exists products_approval_status_idx
  on public.products (approval_status)
  where approval_status = 'pending';

-- Retailers only read approved listings (sellers keep their own rows via
-- products_seller_read_all; admins review through the service role).
drop policy if exists products_read on public.products;
create policy products_read
on public.products
for select
to authenticated
using (
  is_active
  and approval_status = 'approved'
  and seller_id is not null
  and private.is_approved_supplier(seller_id)
);

-- Catalog view mirrors the policy: approved listings only.
drop view if exists public.catalog_products;
create view public.catalog_products
with (security_invoker = true, security_barrier = true)
as
select
  product.id,
  product.name,
  product.description,
  product.price,
  product.unit,
  product.stock,
  product.min_order_qty,
  product.category,
  product.image_url,
  product.seller_id,
  private.supplier_display_name(product.seller_id) as seller_name
from public.products as product
where product.is_active
  and product.approval_status = 'approved';

comment on view public.catalog_products is
  'Approved, active listings from verified suppliers, with a public shop name for the retailer catalog.';

revoke all on public.catalog_products from public, anon, authenticated;
grant select on public.catalog_products to authenticated;

-- ---------------------------------------------------------------------------
-- 2a. Guard supplier writes: new listings start pending; sellers cannot
--     review their own products; editing a rejected listing resubmits it.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_supplier_product_values()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  resubmit boolean := false;
begin
  if new.price is null or new.price <= 0 then
    raise exception 'Product price must be greater than zero.';
  end if;

  if tg_op = 'INSERT' and new.stock < 1 then
    raise exception 'A new product must have at least one unit in stock.';
  end if;

  if tg_op = 'UPDATE'
    and new.stock is distinct from old.stock
    and (select auth.uid()) is not null
    and (select auth.uid()) = old.seller_id
    and new.stock < 0
  then
    raise exception 'Supplier stock cannot be negative.';
  end if;

  -- Sellers (and any non-service-role caller) cannot clear or bypass admin moderation.
  if tg_op = 'UPDATE'
    and (select auth.uid()) is not null
    and old.moderation_status is distinct from 'ok'
  then
    if new.moderation_status is distinct from old.moderation_status
      or new.moderation_reason is distinct from old.moderation_reason
      or new.moderated_by is distinct from old.moderated_by
      or new.moderated_at is distinct from old.moderated_at
    then
      raise exception 'This product was moderated by an administrator and cannot be changed that way.';
    end if;

    if new.is_active is true then
      raise exception 'This product was moderated by an administrator and cannot be shown again.';
    end if;
  end if;

  -- Sellers cannot invent moderation fields on their own products.
  if (select auth.uid()) is not null then
    if tg_op = 'INSERT' then
      new.moderation_status := 'ok';
      new.moderation_reason := null;
      new.moderated_by := null;
      new.moderated_at := null;
    elsif tg_op = 'UPDATE'
      and old.moderation_status = 'ok'
      and (
        new.moderation_status is distinct from 'ok'
        or new.moderation_reason is not null
        or new.moderated_by is not null
        or new.moderated_at is not null
      )
    then
      raise exception 'Only an administrator can moderate a product.';
    end if;
  end if;

  -- Every new listing starts pending admin approval.
  if tg_op = 'INSERT' then
    new.approval_status := 'pending';
    new.approval_note := null;
    new.approved_by := null;
    new.approved_at := null;
  end if;

  -- Sellers cannot move a product through review themselves. Editing the
  -- details of a rejected listing resubmits it for a fresh review; stock and
  -- visibility toggles do not reopen the review.
  if tg_op = 'UPDATE' and (select auth.uid()) is not null then
    resubmit :=
      old.approval_status = 'rejected'
      and (
        new.name is distinct from old.name
        or new.description is distinct from old.description
        or new.price is distinct from old.price
        or new.unit is distinct from old.unit
        or new.category is distinct from old.category
        or new.image_url is distinct from old.image_url
        or new.min_order_qty is distinct from old.min_order_qty
      );

    if resubmit then
      new.approval_status := 'pending';
      new.approval_note := null;
      new.approved_by := null;
      new.approved_at := null;
    elsif new.approval_status is distinct from old.approval_status
      or new.approval_note is distinct from old.approval_note
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
    then
      raise exception 'Only an administrator can review this product.';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_supplier_product_values()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2b. Alerts: admins on submission/resubmission, supplier on decision.
-- ---------------------------------------------------------------------------

create or replace function public.notify_admins_of_product_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (recipient_id, type, title, message)
  select account.id,
    'product_pending_approval',
    'New product awaiting approval',
    'A supplier listed "' || left(new.name, 120) || '". Approve it before it becomes available to retailers.'
  from public.users as account
  where account.role = 'admin';
  return new;
end;
$$;

revoke execute on function public.notify_admins_of_product_submission()
from public, anon, authenticated;

drop trigger if exists products_notify_admin_submission on public.products;
create trigger products_notify_admin_submission
after insert on public.products
for each row
execute function public.notify_admins_of_product_submission();

create or replace function public.notify_on_product_approval_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.approval_status is distinct from old.approval_status then
    if new.approval_status = 'approved' and new.seller_id is not null then
      insert into public.notifications (recipient_id, type, title, message)
      values (
        new.seller_id,
        'product_approved',
        'Your product was approved',
        '"' || left(new.name, 120) || '" passed review and is now available to retailers.'
      );
    elsif new.approval_status = 'rejected' and new.seller_id is not null then
      insert into public.notifications (recipient_id, type, title, message)
      values (
        new.seller_id,
        'product_rejected',
        'Your product was not approved',
        '"' || left(new.name, 120) || '" needs changes before it can be listed.'
          || coalesce(' Reason: ' || nullif(btrim(new.approval_note), ''), '')
      );
    elsif new.approval_status = 'pending' and old.approval_status = 'rejected' then
      insert into public.notifications (recipient_id, type, title, message)
      select account.id,
        'product_pending_approval',
        'Product resubmitted for approval',
        '"' || left(new.name, 120) || '" was updated by the supplier and is waiting for review again.'
      from public.users as account
      where account.role = 'admin';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.notify_on_product_approval_change()
from public, anon, authenticated;

drop trigger if exists products_notify_approval_change on public.products;
create trigger products_notify_approval_change
after update on public.products
for each row
execute function public.notify_on_product_approval_change();

-- ---------------------------------------------------------------------------
-- 2c. Hard guard: order lines can only ever reference approved listings,
--     regardless of which checkout path creates them.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_order_items_product_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  listed_name text;
  review_status text;
begin
  select name, approval_status
  into listed_name, review_status
  from public.products
  where id = new.product_id;

  if review_status is not null and review_status <> 'approved' then
    raise exception '"%" is not available for orders right now.', listed_name;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_order_items_product_approved()
from public, anon, authenticated;

drop trigger if exists order_items_require_approved_product on public.order_items;
create trigger order_items_require_approved_product
before insert on public.order_items
for each row
execute function public.enforce_order_items_product_approved();
