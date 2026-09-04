-- Admin product moderation: hide/remove with required reason, seller lock.

alter table public.products
  add column if not exists moderation_status text not null default 'ok',
  add column if not exists moderation_reason text,
  add column if not exists moderated_by uuid references public.users (id) on delete set null,
  add column if not exists moderated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_moderation_status_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_moderation_status_check
      check (moderation_status in ('ok', 'hidden', 'removed'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_moderation_reason_required'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_moderation_reason_required
      check (
        moderation_status = 'ok'
        or (moderation_reason is not null and length(trim(moderation_reason)) > 0)
      );
  end if;
end;
$$;

create or replace function public.enforce_supplier_product_values()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
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

  return new;
end;
$$;

revoke execute on function public.enforce_supplier_product_values()
from public, anon, authenticated;

comment on column public.products.moderation_status is
  'ok = normal; hidden = admin soft-hide (restorable); removed = admin permanent takedown.';
