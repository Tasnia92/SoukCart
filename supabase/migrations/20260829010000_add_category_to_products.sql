-- Add a category to products so retailers can filter the catalog by
-- category. Free-text label; sellers pick from a curated list in the
-- product form, and existing listings default to NULL (no category).

alter table public.products
  add column if not exists category text;