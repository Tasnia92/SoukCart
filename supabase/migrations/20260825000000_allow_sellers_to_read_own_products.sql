-- Suppliers manage their listings from the supplier dashboard, so they need to
-- see every product they own -- including ones they deactivated (is_active =
-- false). The existing products_read policy only exposes active rows to any
-- authenticated user; this policy additionally lets a seller read their own
-- rows regardless of visibility. Permissive policies are OR-ed, so retailers
-- keep seeing only active products while sellers also see their hidden ones.
create policy products_seller_read_all
on public.products
for select
to authenticated
using (seller_id = auth.uid());
