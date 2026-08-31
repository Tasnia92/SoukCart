drop function if exists public.is_admin();

revoke execute on function public.auto_confirm_email() from anon, authenticated, service_role;
revoke execute on function public.handle_new_user() from anon, authenticated, service_role;
