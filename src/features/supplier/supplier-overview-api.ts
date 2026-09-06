import { supabase } from "../../supabase.ts";

export const SUPPLIER_PRODUCT_COLUMNS =
  "id, name, description, price, unit, stock, min_order_qty, category, image_url, is_active, created_at, stock_version, moderation_status, moderation_reason, moderated_at, approval_status, approval_note";

export type ProductModerationStatus = "ok" | "hidden" | "removed";
export type ProductApprovalStatus = "pending" | "approved" | "rejected";

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
  stock_version: number;
  moderation_status: ProductModerationStatus;
  moderation_reason: string | null;
  moderated_at: string | null;
  approval_status: ProductApprovalStatus;
  approval_note: string | null;
};

type SupplierProductRecord = Omit<
  SupplierProduct,
  | "price"
  | "category"
  | "min_order_qty"
  | "stock_version"
  | "moderation_status"
  | "moderation_reason"
  | "moderated_at"
  | "approval_status"
  | "approval_note"
> & {
  price: number | string;
  min_order_qty: number | string | null;
  category: string | null;
  stock_version?: number | string | null;
  moderation_status?: ProductModerationStatus | null;
  moderation_reason?: string | null;
  moderated_at?: string | null;
  approval_status?: ProductApprovalStatus | null;
  approval_note?: string | null;
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
  const version = Number(product.stock_version);
  const moderationStatus =
    product.moderation_status === "hidden" || product.moderation_status === "removed"
      ? product.moderation_status
      : "ok";
  const approvalStatus =
    product.approval_status === "pending" || product.approval_status === "rejected"
      ? product.approval_status
      : "approved";
  return {
    ...product,
    price: Number(product.price),
    min_order_qty: Number.isInteger(minQty) && minQty >= 1 ? minQty : 1,
    category: product.category ?? null,
    stock_version: Number.isInteger(version) && version >= 0 ? version : 0,
    moderation_status: moderationStatus,
    moderation_reason: product.moderation_reason ?? null,
    moderated_at: product.moderated_at ?? null,
    approval_status: approvalStatus,
    approval_note: product.approval_note ?? null,
  };
}

export function isAdminModerated(product: Pick<SupplierProduct, "moderation_status">): boolean {
  return product.moderation_status === "hidden" || product.moderation_status === "removed";
}

/** True when the listing is still waiting for (or failed) admin review. */
export function isAwaitingReview(product: Pick<SupplierProduct, "approval_status">): boolean {
  return product.approval_status !== "approved";
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
