import { supabase } from "../../supabase.ts";

/** Product thumbnails keyed by product id. Missing or empty URLs are omitted. */
export async function loadProductImageMap(
  productIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (!ids.length) return map;

  const { data, error } = await supabase.from("products").select("id, image_url").in("id", ids);
  if (error || !data) return map;

  for (const row of data as { id: string; image_url: string | null }[]) {
    if (row.image_url) map.set(row.id, row.image_url);
  }
  return map;
}
