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
  min_order_qty: number;
  category: string | null;
};

export type ProductValidationOptions = {
  allowZeroStock?: boolean;
  requireImage?: boolean;
  imageUrl?: string | null;
  hasImageFile?: boolean;
};

export function productValidationError(
  payload: ProductPayload,
  options: ProductValidationOptions = {},
): string | null {
  if (!Number.isFinite(payload.price) || payload.price <= 0) {
    return "Price must be greater than 0.";
  }
  if (!Number.isInteger(payload.min_order_qty) || payload.min_order_qty < 1) {
    return "Minimum order quantity must be a whole number of at least 1.";
  }
  const minStock = options.allowZeroStock ? 0 : 1;
  if (!Number.isInteger(payload.stock) || payload.stock < minStock) {
    return options.allowZeroStock
      ? "Quantity must be a whole number of 0 or more."
      : "Quantity must be a whole number of at least 1.";
  }
  if (!options.allowZeroStock && payload.stock < payload.min_order_qty) {
    return "Stock must be at least the minimum order quantity.";
  }
  if (options.requireImage && !options.hasImageFile && !options.imageUrl?.trim()) {
    return "Please add a product image.";
  }
  return null;
}

function assertValidProduct(payload: ProductPayload, options?: ProductValidationOptions): void {
  const message = productValidationError(payload, options);
  if (message) throw new Error(message);
}

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
  if (!Number.isInteger(stock) || stock < 0) {
    throw new Error("Quantity must be a whole number of 0 or more.");
  }
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
  assertValidProduct(payload, { requireImage: true, imageUrl });
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
  assertValidProduct(payload, { allowZeroStock: true, requireImage: true, imageUrl });
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
