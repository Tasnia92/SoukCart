import { invokeAdmin, type AdminFunctionGateway } from "./admin-overview-api.ts";

export const ADMIN_PRODUCTS_FUNCTION = "admin-product-moderation";

export type ProductModerationStatus = "ok" | "hidden" | "removed";
export type ProductApprovalStatus = "pending" | "approved" | "rejected";

export type AdminProduct = {
  id: string;
  seller_id: string | null;
  name: string;
  description: string;
  price: number;
  unit: string;
  stock: number;
  min_order_qty: number;
  category: string | null;
  image_url: string | null;
  is_active: boolean;
  moderation_status: ProductModerationStatus;
  moderation_reason: string | null;
  moderated_by: string | null;
  moderated_at: string | null;
  approval_status: ProductApprovalStatus;
  approval_note: string | null;
  approved_at: string | null;
  created_at: string;
  seller_name: string;
  seller_email: string;
  shop_name: string | null;
};

export type AdminProductFilter =
  | "all"
  | "active"
  | "pending"
  | "rejected"
  | "hidden"
  | "removed"
  | "seller_hidden";

export type AdminProductSort = "newest" | "oldest";

export const ADMIN_PRODUCT_SORTS: { id: AdminProductSort; label: string }[] = [
  { id: "newest", label: "New to old" },
  { id: "oldest", label: "Old to new" },
];

/** Sort used when no explicit choice is stored (defaults to newest first). */
export function parseAdminProductSort(value: string | null): AdminProductSort {
  return value === "oldest" ? "oldest" : "newest";
}

/** Order products by listing date without mutating the input array. */
export function sortAdminProducts(
  products: readonly AdminProduct[],
  sort: AdminProductSort,
): AdminProduct[] {
  const direction = sort === "oldest" ? 1 : -1;
  return [...products].sort(
    (a, b) => direction * (Date.parse(a.created_at) - Date.parse(b.created_at)),
  );
}

type ProductsResponse = {
  products: AdminProduct[];
};

type ModerateResponse = {
  productId: string;
  moderation_status: ProductModerationStatus;
  purged?: boolean;
};

export async function loadAdminProducts(gateway?: AdminFunctionGateway): Promise<AdminProduct[]> {
  const response = await invokeAdmin<ProductsResponse>(
    { action: "list" },
    ADMIN_PRODUCTS_FUNCTION,
    gateway,
  );
  return response.products;
}

export async function hideAdminProduct(
  productId: string,
  reason: string,
  gateway?: AdminFunctionGateway,
): Promise<ModerateResponse> {
  return invokeAdmin<ModerateResponse>(
    { action: "hide", productId, reason },
    ADMIN_PRODUCTS_FUNCTION,
    gateway,
  );
}

export async function removeAdminProduct(
  productId: string,
  reason: string,
  gateway?: AdminFunctionGateway,
): Promise<ModerateResponse> {
  return invokeAdmin<ModerateResponse>(
    { action: "remove", productId, reason },
    ADMIN_PRODUCTS_FUNCTION,
    gateway,
  );
}

export async function restoreAdminProduct(
  productId: string,
  gateway?: AdminFunctionGateway,
): Promise<ModerateResponse> {
  return invokeAdmin<ModerateResponse>(
    { action: "restore", productId },
    ADMIN_PRODUCTS_FUNCTION,
    gateway,
  );
}

export type ReviewResponse = {
  productId: string;
  approval_status: ProductApprovalStatus;
};

export async function approveAdminProduct(
  productId: string,
  gateway?: AdminFunctionGateway,
): Promise<ReviewResponse> {
  return invokeAdmin<ReviewResponse>(
    { action: "approve", productId },
    ADMIN_PRODUCTS_FUNCTION,
    gateway,
  );
}

export async function rejectAdminProduct(
  productId: string,
  reason: string,
  gateway?: AdminFunctionGateway,
): Promise<ReviewResponse> {
  return invokeAdmin<ReviewResponse>(
    { action: "reject", productId, reason },
    ADMIN_PRODUCTS_FUNCTION,
    gateway,
  );
}

export function filterAdminProducts(
  products: readonly AdminProduct[],
  searchTerm: string,
  status: AdminProductFilter,
): AdminProduct[] {
  const query = searchTerm.trim().toLowerCase();
  return products.filter((product) => {
    if (status === "active") {
      if (
        !(
          product.is_active &&
          product.moderation_status === "ok" &&
          product.approval_status === "approved"
        )
      ) {
        return false;
      }
    } else if (status === "pending") {
      if (product.approval_status !== "pending") return false;
    } else if (status === "rejected") {
      if (product.approval_status !== "rejected") return false;
    } else if (status === "hidden") {
      if (product.moderation_status !== "hidden") return false;
    } else if (status === "removed") {
      if (product.moderation_status !== "removed") return false;
    } else if (status === "seller_hidden") {
      if (
        !(
          product.moderation_status === "ok" &&
          !product.is_active &&
          product.approval_status === "approved"
        )
      ) {
        return false;
      }
    }

    if (!query) return true;
    return [
      product.name,
      product.description,
      product.category ?? "",
      product.seller_name,
      product.seller_email,
      product.shop_name ?? "",
      product.moderation_reason ?? "",
      product.approval_note ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

export type AdminProductStats = {
  total: number;
  active: number;
  pending: number;
  rejected: number;
  hidden: number;
  removed: number;
  sellerHidden: number;
};

export function getAdminProductStats(products: readonly AdminProduct[]): AdminProductStats {
  const stats: AdminProductStats = {
    total: products.length,
    active: 0,
    pending: 0,
    rejected: 0,
    hidden: 0,
    removed: 0,
    sellerHidden: 0,
  };
  for (const product of products) {
    if (product.approval_status === "pending") stats.pending += 1;
    if (product.approval_status === "rejected") stats.rejected += 1;
    if (product.moderation_status === "hidden") stats.hidden += 1;
    else if (product.moderation_status === "removed") stats.removed += 1;
    else if (product.is_active && product.approval_status === "approved") stats.active += 1;
    else if (product.approval_status === "approved") stats.sellerHidden += 1;
  }
  return stats;
}
