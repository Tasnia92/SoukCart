export function toShopSlug(input) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.replace(/^soukcart\.dev\/@?/, '');
  s = s.replace(/^soukcart\.com\/@?/, '');
  s = s.replace(/.*\//, '');
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s;
}
