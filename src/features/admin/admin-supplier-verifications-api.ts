import { invokeAdmin, type AdminFunctionGateway } from "./admin-overview-api.ts";

export const ADMIN_VERIFICATIONS_FUNCTION = "admin-supplier-verifications";

export type VerificationStatus = "pending" | "approved" | "rejected";

export type AdminSupplierVerification = {
  user_id: string;
  shop_name: string;
  shop_details: string;
  location: string;
  status: VerificationStatus;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  supplier_name: string;
  supplier_email: string;
  /** Short-lived signed URL for the trade licence, or null if it could not be signed. */
  trade_license_url: string | null;
};

type VerificationsResponse = {
  verifications: AdminSupplierVerification[];
};

export async function loadSupplierVerifications(
  gateway?: AdminFunctionGateway,
): Promise<AdminSupplierVerification[]> {
  const response = await invokeAdmin<VerificationsResponse>(
    { action: "list" },
    ADMIN_VERIFICATIONS_FUNCTION,
    gateway,
  );
  return response.verifications;
}

export async function approveSupplier(
  userId: string,
  gateway?: AdminFunctionGateway,
): Promise<void> {
  await invokeAdmin<unknown>({ action: "approve", userId }, ADMIN_VERIFICATIONS_FUNCTION, gateway);
}

export async function rejectSupplier(
  userId: string,
  note: string,
  gateway?: AdminFunctionGateway,
): Promise<void> {
  await invokeAdmin<unknown>(
    { action: "reject", userId, note },
    ADMIN_VERIFICATIONS_FUNCTION,
    gateway,
  );
}

export type TradeLicenseKind = "image" | "pdf" | "file";

/**
 * Guess how to render a signed trade-licence URL. Signed URLs keep the original
 * object path (with its extension) before the `?token=` query, so we can read
 * the extension to decide between an inline image, an embedded PDF, or a plain
 * download link.
 */
export function tradeLicenseKind(url: string | null): TradeLicenseKind {
  if (!url) return "file";
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split("?")[0] ?? url;
  }
  const lower = path.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(lower)) return "image";
  if (lower.endsWith(".pdf")) return "pdf";
  return "file";
}

export function filterVerifications(
  verifications: readonly AdminSupplierVerification[],
  searchTerm: string,
): AdminSupplierVerification[] {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return [...verifications];
  return verifications.filter((verification) =>
    [
      verification.shop_name,
      verification.shop_details,
      verification.location,
      verification.supplier_name,
      verification.supplier_email,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

export type VerificationStats = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
};

export function getVerificationStats(
  verifications: readonly AdminSupplierVerification[],
): VerificationStats {
  const stats: VerificationStats = {
    total: verifications.length,
    pending: 0,
    approved: 0,
    rejected: 0,
  };
  for (const verification of verifications) {
    stats[verification.status] += 1;
  }
  return stats;
}

/** Pending applications come first (oldest first, so the queue is FIFO); decided ones follow, newest first. */
export function sortVerificationsForReview(
  verifications: readonly AdminSupplierVerification[],
): AdminSupplierVerification[] {
  return [...verifications].sort((left, right) => {
    if (left.status === "pending" && right.status !== "pending") return -1;
    if (left.status !== "pending" && right.status === "pending") return 1;
    if (left.status === "pending" && right.status === "pending") {
      return left.created_at.localeCompare(right.created_at);
    }
    return right.updated_at.localeCompare(left.updated_at);
  });
}
