import { supabase } from "../../supabase.ts";

export const SUPPLIER_PRODUCT_COLUMNS =
  "id, name, description, price, unit, stock, min_order_qty, category, image_url, is_active, created_at, reorder_threshold, stock_version, moderation_status, moderation_reason, moderated_at";

export type ProductModerationStatus = "ok" | "hidden" | "removed";

export type SupplierProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  stock: number;
  min_order_qty: number;
  category: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  reorder_threshold: number;
  stock_version: number;
  moderation_status: ProductModerationStatus;
  moderation_reason: string | null;
  moderated_at: string | null;
};

type SupplierProductRecord = Omit<
  SupplierProduct,
  | "price"
  | "category"
  | "min_order_qty"
  | "reorder_threshold"
  | "stock_version"
  | "moderation_status"
  | "moderation_reason"
  | "moderated_at"
> & {
  price: number | string;
  min_order_qty: number | string | null;
  category: string | null;
  reorder_threshold?: number | string | null;
  stock_version?: number | string | null;
  moderation_status?: ProductModerationStatus | null;
  moderation_reason?: string | null;
  moderated_at?: string | null;
};

type SupplierProductsQuery = {
  eq: (column: string, value: string) => SupplierProductsQuery;
  order: (
    column: string,
    options: { ascending: boolean },
  ) => Promise<{ data: SupplierProductRecord[] | null; error: { message: string } | null }>;
};

export type SupplierProductsGateway = {
  from: (table: "products") => {
    select: (columns: string) => SupplierProductsQuery;
  };
};

const supplierGateway = supabase as unknown as SupplierProductsGateway;

export function normalizeSupplierProduct(product: SupplierProductRecord): SupplierProduct {
  const minQty = Number(product.min_order_qty);
  const reorder = Number(product.reorder_threshold);
  const version = Number(product.stock_version);
  const moderationStatus =
    product.moderation_status === "hidden" || product.moderation_status === "removed"
      ? product.moderation_status
      : "ok";
  return {
    ...product,
    price: Number(product.price),
    min_order_qty: Number.isInteger(minQty) && minQty >= 1 ? minQty : 1,
    category: product.category ?? null,
    reorder_threshold: Number.isInteger(reorder) && reorder >= 0 ? reorder : 5,
    stock_version: Number.isInteger(version) && version >= 0 ? version : 0,
    moderation_status: moderationStatus,
    moderation_reason: product.moderation_reason ?? null,
    moderated_at: product.moderated_at ?? null,
  };
}

export function isAdminModerated(product: Pick<SupplierProduct, "moderation_status">): boolean {
  return product.moderation_status === "hidden" || product.moderation_status === "removed";
}

export async function loadSupplierProducts(
  sellerId: string,
  gateway: SupplierProductsGateway = supplierGateway,
): Promise<SupplierProduct[]> {
  const { data, error } = await gateway
    .from("products")
    .select(SUPPLIER_PRODUCT_COLUMNS)
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(normalizeSupplierProduct);
}

// Catalog totals now come from `buildSupplierDashboard`, which weighs them against
// incoming orders and stock risk instead of reporting the catalog in isolation.
