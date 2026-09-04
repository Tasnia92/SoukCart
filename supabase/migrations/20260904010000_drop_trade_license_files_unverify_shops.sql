-- Trade licence scans are no longer part of supplier verification. Keep the
-- licence *number*, delete stored licence files, drop the path column, and
-- mark every shop unverified so sellers resubmit with the current identity
-- requirements (licence number, contact phone, NID front and back).

-- Direct deletes on storage.objects are blocked unless this session flag is set.
-- The Storage API sets it automatically; SQL migrations must opt in so the S3
-- object is removed with the row instead of leaving an orphan.
set local storage.allow_delete_query = true;

delete from storage.objects as object
using public.supplier_profiles as profile
where object.bucket_id = 'trade-licenses'
  and object.name = profile.trade_license_path
  and profile.trade_license_path <> ''
  and profile.trade_license_path is distinct from profile.nid_front_path
  and profile.trade_license_path is distinct from profile.nid_back_path;

alter table public.supplier_profiles
  drop column if exists trade_license_path;

update public.supplier_profiles
set
  status = 'rejected',
  review_note =
    'Verification requirements have changed. Resubmit with your trade licence number, contact phone, and both sides of your NID card.',
  reviewed_by = null,
  reviewed_at = null;
