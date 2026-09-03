/** Reads a query parameter from a TanStack `location.searchStr` or a raw query. */
export function searchParam(searchStr: string, key: string): string | null {
  const query = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr;
  const value = new URLSearchParams(query).get(key);
  return value && value.length ? value : null;
}

/** Reads `order-<id>` / `complaint-<id>` from a location hash. */
export function recordIdFromHash(hash: string, prefix: string): string | null {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!value.startsWith(`${prefix}-`)) return null;
  const id = value.slice(prefix.length + 1);
  return id.length ? id : null;
}
