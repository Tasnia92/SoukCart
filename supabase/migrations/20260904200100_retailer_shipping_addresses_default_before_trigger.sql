drop trigger if exists retailer_shipping_addresses_single_default on public.retailer_shipping_addresses;

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
