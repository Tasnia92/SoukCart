import { supabase } from "../../supabase.ts";

export type AdminPayoutSeller = {
  sellerId: string;
  sellerName: string;
  sellerEmail: string;
  available: number;
  paid: number;
  lastPaidAt: string | null;
};

export type AdminPayoutRow = {
  id: string;
  sellerId: string;
  sellerName: string;
  orderId: string;
  gross: number;
  commissionRate: number;
  commissionAmount: number;
  netPayable: number;
  status: "available" | "paid" | "reversed";
  accruedAt: string;
  paidAt: string | null;
};

export type AdminPayoutOverview = {
  commissionRate: number;
  commissionEarned: number;
  pendingPayout: number;
  paidOut: number;
  sellers: AdminPayoutSeller[];
  recent: AdminPayoutRow[];
};

export type MarkSellerPaidResult = {
  sellerId: string;
  paidTotal: number;
  paidCount: number;
};

function asNumber(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payoutStatus(value: unknown): AdminPayoutRow["status"] {
  return value === "paid" || value === "reversed" ? value : "available";
}

function parseSeller(value: unknown): AdminPayoutSeller | null {
  if (!isRecord(value)) return null;
  const sellerId = asText(value.sellerId);
  if (!sellerId) return null;
  return {
    sellerId,
    sellerName: asText(value.sellerName) || "Supplier",
    sellerEmail: asText(value.sellerEmail),
    available: asNumber(value.available),
    paid: asNumber(value.paid),
    lastPaidAt: asNullableText(value.lastPaidAt),
  };
}

function parseRow(value: unknown): AdminPayoutRow | null {
  if (!isRecord(value)) return null;
  const id = asText(value.id);
  const sellerId = asText(value.sellerId);
  const orderId = asText(value.orderId);
  const accruedAt = asText(value.accruedAt);
  if (!id || !sellerId || !orderId || !accruedAt) return null;
  return {
    id,
    sellerId,
    sellerName: asText(value.sellerName) || "Supplier",
    orderId,
    gross: asNumber(value.gross),
    commissionRate: asNumber(value.commissionRate),
    commissionAmount: asNumber(value.commissionAmount),
    netPayable: asNumber(value.netPayable),
    status: payoutStatus(value.status),
    accruedAt,
    paidAt: asNullableText(value.paidAt),
  };
}

function parseOverview(value: unknown): AdminPayoutOverview {
  const row = isRecord(value) ? value : {};
  return {
    commissionRate: asNumber(row.commissionRate),
    commissionEarned: asNumber(row.commissionEarned),
    pendingPayout: asNumber(row.pendingPayout),
    paidOut: asNumber(row.paidOut),
    sellers: Array.isArray(row.sellers)
      ? row.sellers
          .map(parseSeller)
          .filter((seller): seller is AdminPayoutSeller => Boolean(seller))
      : [],
    recent: Array.isArray(row.recent)
      ? row.recent.map(parseRow).filter((item): item is AdminPayoutRow => Boolean(item))
      : [],
  };
}

export async function loadAdminPayouts(): Promise<AdminPayoutOverview> {
  const { data, error } = await supabase.rpc("admin_payout_overview");
  if (error) throw new Error(error.message);
  return parseOverview(data);
}

export async function setCommissionRate(rate: number): Promise<number> {
  const { data, error } = await supabase.rpc("admin_set_commission_rate", { p_rate: rate });
  if (error) throw new Error(error.message);
  const applied = asNumber(data);
  if (applied < 0) throw new Error("The commission rate could not be saved.");
  return applied;
}

export async function markSellerPaid(sellerId: string): Promise<MarkSellerPaidResult> {
  const { data, error } = await supabase.rpc("admin_mark_seller_paid", { p_seller_id: sellerId });
  if (error) throw new Error(error.message);
  if (!isRecord(data)) throw new Error("The payout could not be recorded.");
  return {
    sellerId: asText(data.sellerId) || sellerId,
    paidTotal: asNumber(data.paidTotal),
    paidCount: asNumber(data.paidCount),
  };
}

export function percentFromRate(rate: number): string {
  return (rate * 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

export function rateFromPercent(raw: string): number | null {
  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent < 0 || percent >= 100) return null;
  return Math.round(percent * 100) / 10000;
}
