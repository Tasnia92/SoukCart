import { supabase } from "../../supabase.ts";
import {
  isProductAtRisk,
  isProductLowStock,
  isProductOutOfStock,
  productReorderThreshold,
} from "./supplier-dashboard-api.ts";
import {
  loadSupplierProducts,
  normalizeSupplierProduct,
  SUPPLIER_PRODUCT_COLUMNS,
  type SupplierProduct,
} from "./supplier-overview-api.ts";

export { loadSupplierProducts };
export type { SupplierProduct };
export { isProductAtRisk, isProductLowStock, isProductOutOfStock, productReorderThreshold };

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

/**
 * Categories offered in the product form: the admin-managed list with the
 * static curated list as a fallback (e.g. if the table is unreachable).
 */
export async function loadProductCategoryOptions(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("categories")
      .select("name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw error;
    const names = ((data ?? []) as { name: string }[])
      .map((row) => (typeof row.name === "string" ? row.name.trim() : ""))
      .filter((name) => name.length > 0);
    return names.length ? names : [...PRODUCT_CATEGORIES];
  } catch {
    return [...PRODUCT_CATEGORIES];
  }
}

/** Ensure a product's current category stays selectable, even if hidden/removed. */
export function mergeCurrentCategory(options: readonly string[], current: string | null): string[] {
  if (!current) return [...options];
  return options.includes(current)
    ? [...options]
    : [...options, current].sort((a, b) => a.localeCompare(b));
}

export type ProductUnitOption = { value: string; label: string };

/**
 * Units offered in the product form. The value is stored verbatim in
 * `products.unit` and shown to retailers (e.g. "per kg", "100 kg available"),
 * so keep values short and human-readable.
 */
export const PRODUCT_UNITS: ReadonlyArray<ProductUnitOption> = [
  { value: "kg", label: "Kilogram (kg)" },
  { value: "g", label: "Gram (g)" },
  { value: "litre", label: "Litre" },
  { value: "piece", label: "Piece" },
  { value: "dozen", label: "Dozen" },
  { value: "packet", label: "Packet" },
  { value: "box", label: "Box" },
  { value: "carton", label: "Carton" },
  { value: "crate", label: "Crate" },
  { value: "sack", label: "Sack" },
  { value: "bundle", label: "Bundle" },
  { value: "bottle", label: "Bottle" },
];

/** Unit used when a product has none (form fallback and database default). */
export const DEFAULT_PRODUCT_UNIT = "piece";

/**
 * Unit picker options, with a product's current unit appended when it is a
 * legacy free-text value that is not part of the curated list.
 */
export function productUnitOptions(current: string): ReadonlyArray<ProductUnitOption> {
  if (!current || PRODUCT_UNITS.some((unit) => unit.value === current)) return PRODUCT_UNITS;
  return [...PRODUCT_UNITS, { value: current, label: current }];
}

export const PRODUCT_IMAGES_BUCKET = "product-images";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const CATALOG_PAGE_SIZE = 12;

/** Longest description accepted for a product (form limit and shared validator). */
export const MAX_PRODUCT_DESCRIPTION = 2000;

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

export type StockAdjustMode = "absolute" | "relative";

export type StockAdjustmentInput = {
  productId: string;
  mode: StockAdjustMode;
  value: number;
  expectedVersion: number;
  reason?: string;
  reorderThreshold?: number | null;
};

export type StockAdjustmentResult = {
  id: string;
  stock: number;
  stockVersion: number;
  reorderThreshold: number;
  previousStock: number;
  delta: number;
};

export type StockAdjustmentHistoryRow = {
  id: string;
  product_id: string;
  previous_stock: number;
  new_stock: number;
  delta: number;
  reason: string;
  created_at: string;
};

export type ProductSort = "newest" | "stock" | "price" | "name";

/** Map PostgREST / Postgres errors into short seller-facing copy. */
export function friendlyProductError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error &&
            typeof error === "object" &&
            "message" in error &&
            typeof error.message === "string"
          ? error.message
          : "";
  const lower = message.toLowerCase();
  if (lower.includes("stock changed elsewhere")) {
    return "Stock changed elsewhere. Refresh and try again.";
  }
  if (lower.includes("product not found")) {
    return "That product is no longer in your catalog.";
  }
  if (lower.includes("must be verified") || lower.includes("approved")) {
    return "Your shop must be verified before you can manage products.";
  }
  if (lower.includes("duplicate key") || lower.includes("unique")) {
    return "A conflicting product record already exists.";
  }
  if (lower.includes("violates check constraint") && lower.includes("stock")) {
    return "Stock must be a whole number of 0 or more.";
  }
  if (lower.includes("moderated by an administrator")) {
    return "An administrator moderated this product. You cannot show it again yourself.";
  }
  if (lower.includes("only an administrator can moderate")) {
    return "Only an administrator can change moderation on this product.";
  }
  if (lower.includes("violates row-level security") || lower.includes("permission denied")) {
    return "You do not have permission to change this product.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Network error. Check your connection and try again.";
  }
  return message || "Please try again.";
}

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
  if (payload.description.length > MAX_PRODUCT_DESCRIPTION) {
    return `Keep the description under ${MAX_PRODUCT_DESCRIPTION} characters.`;
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

export function sortSupplierProducts(
  products: readonly SupplierProduct[],
  sort: ProductSort,
): SupplierProduct[] {
  const next = [...products];
  switch (sort) {
    case "stock":
      return next.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
    case "price":
      return next.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
    case "name":
      return next.sort((a, b) => a.name.localeCompare(b.name));
    case "newest":
    default:
      return next.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }
}

export function paginateProducts<T>(
  items: readonly T[],
  page: number,
  pageSize = CATALOG_PAGE_SIZE,
): { items: T[]; page: number; pageCount: number; total: number } {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize) as T[],
    page: safePage,
    pageCount,
    total,
  };
}

export async function loadSupplierProduct(
  sellerId: string,
  productId: string,
): Promise<SupplierProduct | null> {
  const { data, error } = await supabase
    .from("products")
    .select(SUPPLIER_PRODUCT_COLUMNS)
    .eq("seller_id", sellerId)
    .eq("id", productId)
    .maybeSingle();
  if (error) throw new Error(friendlyProductError(error));
  return data ? normalizeSupplierProduct(data) : null;
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
  if (error) throw new Error(friendlyProductError(error));
}

export async function setProductsActive(
  sellerId: string,
  productIds: readonly string[],
  isActive: boolean,
): Promise<void> {
  if (!productIds.length) return;
  const { error } = await supabase
    .from("products")
    .update({ is_active: isActive })
    .eq("seller_id", sellerId)
    .in("id", [...productIds]);
  if (error) throw new Error(friendlyProductError(error));
}

export async function deleteSupplierProduct(sellerId: string, productId: string): Promise<void> {
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("seller_id", sellerId);
  if (error) throw new Error(friendlyProductError(error));
}

export async function deleteSupplierProducts(
  sellerId: string,
  productIds: readonly string[],
): Promise<void> {
  if (!productIds.length) return;
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("seller_id", sellerId)
    .in("id", [...productIds]);
  if (error) throw new Error(friendlyProductError(error));
}

export async function saveProductStock(
  _sellerId: string,
  productId: string,
  stock: number,
  expectedVersion = 0,
  reason = "",
): Promise<StockAdjustmentResult> {
  return adjustProductStock({
    productId,
    mode: "absolute",
    value: stock,
    expectedVersion,
    reason,
  });
}

export async function adjustProductStock(
  input: StockAdjustmentInput,
): Promise<StockAdjustmentResult> {
  if (input.mode === "absolute" && (!Number.isInteger(input.value) || input.value < 0)) {
    throw new Error("Quantity must be a whole number of 0 or more.");
  }
  if (input.mode === "relative" && !Number.isInteger(input.value)) {
    throw new Error("Adjustment must be a whole number.");
  }

  const { data, error } = await supabase.rpc("seller_adjust_stock", {
    p_product_id: input.productId,
    p_mode: input.mode,
    p_value: input.value,
    p_expected_version: input.expectedVersion,
    p_reason: input.reason ?? "",
    p_reorder_threshold: input.reorderThreshold ?? null,
  });
  if (error) throw new Error(friendlyProductError(error));
  return normalizeStockAdjustmentResult(data);
}

export async function bulkAdjustProductStock(
  adjustments: readonly StockAdjustmentInput[],
): Promise<StockAdjustmentResult[]> {
  if (!adjustments.length) return [];
  const payload = adjustments.map((item) => ({
    productId: item.productId,
    mode: item.mode,
    value: item.value,
    expectedVersion: item.expectedVersion,
    reason: item.reason ?? "",
    ...(item.reorderThreshold === undefined || item.reorderThreshold === null
      ? {}
      : { reorderThreshold: item.reorderThreshold }),
  }));
  const { data, error } = await supabase.rpc("seller_bulk_adjust_stock", {
    p_adjustments: payload,
  });
  if (error) throw new Error(friendlyProductError(error));
  const row = data as { results?: unknown } | null;
  const results = Array.isArray(row?.results) ? row.results : [];
  return results.map(normalizeStockAdjustmentResult);
}

function normalizeStockAdjustmentResult(value: unknown): StockAdjustmentResult {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    id: typeof row.id === "string" ? row.id : "",
    stock: Number(row.stock) || 0,
    stockVersion: Number(row.stockVersion) || 0,
    reorderThreshold: Number(row.reorderThreshold) || 5,
    previousStock: Number(row.previousStock) || 0,
    delta: Number(row.delta) || 0,
  };
}

export async function loadStockAdjustmentHistory(limit = 40): Promise<StockAdjustmentHistoryRow[]> {
  const { data, error } = await supabase
    .from("stock_adjustments")
    .select("id, product_id, previous_stock, new_stock, delta, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(friendlyProductError(error));
  return (data ?? []) as StockAdjustmentHistoryRow[];
}

export async function duplicateSupplierProduct(
  productId: string,
): Promise<{ id: string; name: string }> {
  const { data, error } = await supabase.rpc("seller_duplicate_product", {
    p_product_id: productId,
  });
  if (error) throw new Error(friendlyProductError(error));
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    id: typeof row.id === "string" ? row.id : "",
    name: typeof row.name === "string" ? row.name : "Copy",
  };
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
  if (error) throw new Error(friendlyProductError(error));
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
  if (error) throw new Error(friendlyProductError(error));
}

export function extractObjectPath(url: string): string | null {
  const marker = `/object/public/${PRODUCT_IMAGES_BUCKET}/`;
  const index = url.indexOf(marker);
  return index === -1 ? null : decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function buildInventoryCsv(products: readonly SupplierProduct[]): string {
  const header = [
    "product_id",
    "name",
    "unit",
    "stock",
    "reorder_threshold",
    "is_active",
    "category",
    "stock_version",
  ];
  const lines = products.map((product) =>
    [
      product.id,
      product.name,
      product.unit,
      String(product.stock),
      String(product.reorder_threshold),
      product.is_active ? "true" : "false",
      product.category ?? "",
      String(product.stock_version),
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export type InventoryCsvRow = {
  productId: string;
  stock: number;
  reorderThreshold?: number;
  reason?: string;
};

/** Parse inventory CSV rows for absolute stock import. */
export function parseInventoryCsv(text: string): InventoryCsvRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error("CSV needs a header row and at least one product row.");

  const header = splitCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const idIdx = header.findIndex((cell) => cell === "product_id" || cell === "id");
  const stockIdx = header.findIndex((cell) => cell === "stock" || cell === "quantity");
  const thresholdIdx = header.findIndex(
    (cell) => cell === "reorder_threshold" || cell === "threshold",
  );
  const reasonIdx = header.findIndex((cell) => cell === "reason");

  if (idIdx < 0 || stockIdx < 0) {
    throw new Error("CSV must include product_id and stock columns.");
  }

  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    const productId = (cells[idIdx] ?? "").trim();
    const stock = Number((cells[stockIdx] ?? "").trim());
    if (!productId) throw new Error(`Row ${index + 2}: missing product_id.`);
    if (!Number.isInteger(stock) || stock < 0) {
      throw new Error(`Row ${index + 2}: stock must be a whole number of 0 or more.`);
    }
    const row: InventoryCsvRow = { productId, stock };
    if (thresholdIdx >= 0 && cells[thresholdIdx]?.trim()) {
      const threshold = Number(cells[thresholdIdx].trim());
      if (!Number.isInteger(threshold) || threshold < 0) {
        throw new Error(`Row ${index + 2}: reorder_threshold must be 0 or more.`);
      }
      row.reorderThreshold = threshold;
    }
    if (reasonIdx >= 0 && cells[reasonIdx]?.trim()) {
      row.reason = cells[reasonIdx].trim().slice(0, 200);
    }
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}
