import { supabase } from "../../supabase.ts";
import { loadSupplierProducts, type SupplierProduct } from "./supplier-overview-api.ts";

export { loadSupplierProducts };
export type { SupplierProduct };

export const PRODUCT_CATEGORIES = [
  "Rice & Grains",
  "Pulses & Lentils",
  "Oils & Ghee",
  "Vegetables",
  "Fruits",
  "Dairy & Eggs",
  "Meat & Fish",
  "Spices",
  "Snacks & Drinks",
  "Bakery & Sweets",
  "Household",
  "Other",
] as const;

export const PRODUCT_IMAGES_BUCKET = "product-images";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ProductPayload = {
  name: string;
  description: string;
  price: number;
  unit: string;
  stock: number;
  category: string | null;
};

export function filterSupplierProducts(
  products: readonly SupplierProduct[],
  searchTerm: string,
): SupplierProduct[] {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return [...products];
  return products.filter((product) =>
    [product.name, product.description, product.unit, product.category ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

export async function loadSupplierProduct(
  sellerId: string,
  productId: string,
  loader: (sellerId: string) => Promise<SupplierProduct[]> = loadSupplierProducts,
): Promise<SupplierProduct | null> {
  const products = await loader(sellerId);
  return products.find((product) => product.id === productId) ?? null;
}

export async function setProductActive(
  sellerId: string,
  productId: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({ is_active: isActive })
    .eq("id", productId)
    .eq("seller_id", sellerId);
  if (error) throw new Error(error.message);
}

export async function deleteSupplierProduct(sellerId: string, productId: string): Promise<void> {
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("seller_id", sellerId);
  if (error) throw new Error(error.message);
}

export async function saveProductStock(
  sellerId: string,
  productId: string,
  stock: number,
): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({ stock })
    .eq("id", productId)
    .eq("seller_id", sellerId);
  if (error) throw new Error(error.message);
}

export async function uploadProductImage(userId: string, file: File): Promise<string> {
  const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const objectPath = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(objectPath, file, { contentType: file.type, cacheControl: "3600" });
  if (error) throw new Error(`The image could not be uploaded. ${error.message}`);
  return supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

export async function removeStoredImage(url: string): Promise<void> {
  const objectPath = extractObjectPath(url);
  if (!objectPath) return;
  try {
    await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([objectPath]);
  } catch {
    // Best-effort cleanup; an orphaned image does not affect the listing.
  }
}

export async function createSupplierProduct(
  sellerId: string,
  payload: ProductPayload,
  imageUrl: string | null,
): Promise<void> {
  const { error } = await supabase.from("products").insert({
    ...payload,
    seller_id: sellerId,
    image_url: imageUrl,
    is_active: true,
  });
  if (error) throw new Error(error.message);
}

export async function updateSupplierProduct(
  sellerId: string,
  productId: string,
  payload: ProductPayload,
  imageUrl: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({ ...payload, image_url: imageUrl })
    .eq("id", productId)
    .eq("seller_id", sellerId);
  if (error) throw new Error(error.message);
}

export function extractObjectPath(url: string): string | null {
  const marker = `/object/public/${PRODUCT_IMAGES_BUCKET}/`;
  const index = url.indexOf(marker);
  return index === -1 ? null : decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
}
