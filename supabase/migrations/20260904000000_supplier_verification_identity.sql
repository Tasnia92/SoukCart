-- Extra identity details for supplier verification.
--
-- Sellers already upload a trade-licence scan. Review also needs the licence
-- number, both sides of the national ID card, and a contact phone. Files still
-- live in the private `trade-licenses` bucket under the seller's own folder.

alter table public.supplier_profiles
  add column if not exists trade_license_number text not null default '',
  add column if not exists nid_front_path text not null default '',
  add column if not exists nid_back_path text not null default '',
  add column if not exists contact_phone text not null default '';

comment on column public.supplier_profiles.trade_license_number is
  'Government trade licence number provided by the seller.';

comment on column public.supplier_profiles.nid_front_path is
  'Object path in the private trade-licenses bucket for the NID card front.';

comment on column public.supplier_profiles.nid_back_path is
  'Object path in the private trade-licenses bucket for the NID card back.';

comment on column public.supplier_profiles.contact_phone is
  'Seller contact phone for admin review and follow-up.';
