-- Public bucket for supplier product images. Objects are stored under
-- "<auth.uid()>/<uuid>.<ext>" so each seller can only write inside their own
-- folder; the public URL is stored in products.image_url.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Anyone (including anonymous visitors) may view product images.
create policy product_images_public_read
on storage.objects for select
using (bucket_id = 'product-images');

-- Sellers may upload only inside their own top-level folder.
create policy product_images_owner_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Sellers may clean up their own objects when replacing or removing images.
create policy product_images_owner_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
