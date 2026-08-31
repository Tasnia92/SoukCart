drop policy if exists admins_read_all on public.users;
drop policy if exists users_read_own on public.users;
drop policy if exists users_update_own on public.users;

create policy users_read_own
on public.users
for select
to authenticated
using (id = auth.uid());

create policy users_update_own
on public.users
for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and role in ('seller', 'retailer')
);

revoke execute on function public.auto_confirm_email() from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.is_admin() from public;
