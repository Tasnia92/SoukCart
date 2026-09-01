import { supabase } from "../../supabase.ts";

export const PAYMENT_RETURN_KEY = "soukcart:payment-return";

export type PaymentOutcome = "success" | "failed" | "cancelled" | "unknown";

// Maps the SSLCommerz `status` query value to a coarse outcome, matching the legacy logic.
export function paymentOutcome(status: string): PaymentOutcome {
  const value = status.toUpperCase();
  if (value === "VALID") return "success";
  if (value === "CANCELLED") return "cancelled";
  return value ? "failed" : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type PaymentSettlement = { paid: boolean; orderId: string };

export async function completePayment(
  tranId: string,
  valId: string,
  status: string,
): Promise<PaymentSettlement> {
  const { data, error } = await supabase.functions.invoke("sslcommerz-checkout", {
    body: { action: "complete", tranId, valId, status },
  });
  const payload = isRecord(data) ? data : null;
  return {
    paid: !error && payload?.paymentStatus === "paid",
    orderId: typeof payload?.orderId === "string" ? payload.orderId : "",
  };
}

export type PaymentQuery = { paymentStatus: string; orderId: string };

export async function queryPayment(tranId: string): Promise<PaymentQuery> {
  const { data } = await supabase.functions.invoke("sslcommerz-checkout", {
    body: { action: "query", tranId },
  });
  const payload = isRecord(data) ? data : null;
  return {
    paymentStatus: typeof payload?.paymentStatus === "string" ? payload.paymentStatus : "",
    orderId: typeof payload?.orderId === "string" ? payload.orderId : "",
  };
}

export type RecentOrder = { id: string; tran_id: string | null; payment_status: string | null };

export async function loadLatestRecentOrder(userId: string): Promise<RecentOrder | null> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("orders")
    .select("id, tran_id, payment_status")
    .eq("retailer_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as RecentOrder | null) ?? null;
}

export async function getSessionUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function clearCart(userId: string): Promise<void> {
  await supabase.from("cart_items").delete().eq("user_id", userId);
}
