import { supabase } from "../../supabase.ts";

export type RetailerOrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
export type PaymentStatus = "unpaid" | "paid" | "failed" | "cancelled";
export type PaymentMethod = "online" | "cod";
export type CancellationInitiator = "retailer" | "supplier" | "admin" | "support" | null;
export type ManualRefundStatus = "not_required" | "review_required" | "pending" | "completed";

export type RetailerOrderItem = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  product_name: string;
};

export type RetailerOrder = {
  id: string;
  status: RetailerOrderStatus;
  cancel_requested: boolean;
  cancellation_initiator: CancellationInitiator;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  tran_id: string | null;
  notes: string | null;
  created_at: string;
  delivery_verified_at: string | null;
  manual_refund_status: ManualRefundStatus;
  refund_amount: number;
  platform_charge: number;
  delivery_charge: number;
  items: RetailerOrderItem[];
};

const ORDERS_SELECT =
  "id, status, cancel_requested, cancellation_initiator, payment_status, payment_method, tran_id, notes, created_at, delivery_verified_at, manual_refund_status, refund_amount, platform_charge, delivery_charge, order_items(id, product_id, quantity, unit_price, products(name))";

type OrderItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number | string;
  products: { name: string } | { name: string }[] | null;
};

type OrderRow = {
  id: string;
  status: string;
  cancel_requested: boolean | null;
  cancellation_initiator: string | null;
  payment_status: string | null;
  payment_method: string | null;
  tran_id: string | null;
  notes: string | null;
  created_at: string;
  delivery_verified_at: string | null;
  manual_refund_status: string | null;
  refund_amount: number | string | null;
  platform_charge: number | string | null;
  delivery_charge: number | string | null;
  order_items: OrderItemRow[] | null;
};

function productName(relation: OrderItemRow["products"]): string {
  if (Array.isArray(relation)) return relation[0]?.name ?? "Unknown product";
  return relation?.name ?? "Unknown product";
}

function normalizeOrder(row: OrderRow): RetailerOrder {
  return {
    id: row.id,
    status: row.status as RetailerOrderStatus,
    cancel_requested: row.cancel_requested === true,
    cancellation_initiator: (row.cancellation_initiator ?? null) as CancellationInitiator,
    payment_status: (row.payment_status ?? "unpaid") as PaymentStatus,
    payment_method: (row.payment_method ?? "online") as PaymentMethod,
    tran_id: row.tran_id ?? null,
    notes: row.notes,
    created_at: row.created_at,
    delivery_verified_at: row.delivery_verified_at ?? null,
    manual_refund_status: (row.manual_refund_status ?? "not_required") as ManualRefundStatus,
    refund_amount: Number(row.refund_amount ?? 0),
    platform_charge: Number(row.platform_charge ?? 0),
    delivery_charge: Number(row.delivery_charge ?? 0),
    items: (row.order_items ?? []).map((item) => ({
      id: item.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: Number(item.unit_price),
      product_name: productName(item.products),
    })),
  };
}

export async function loadRetailerOrders(retailerId: string): Promise<RetailerOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDERS_SELECT)
    .eq("retailer_id", retailerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as OrderRow[]).map(normalizeOrder);
}

export async function loadCartCount(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("cart_items")
    .select("product_id, quantity")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { quantity: number }[]).reduce(
    (sum, row) => sum + (row.quantity > 0 ? row.quantity : 0),
    0,
  );
}

export type PaymentQueryResult = "paid" | "failed" | "cancelled" | "pending";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function queryPaymentStatus(tranId: string): Promise<PaymentQueryResult> {
  const { data, error } = await supabase.functions.invoke("sslcommerz-checkout", {
    body: { action: "query", tranId },
  });
  if (error) return "pending";
  const payload = isRecord(data) ? data : null;
  const status = typeof payload?.paymentStatus === "string" ? payload.paymentStatus : "";
  return status === "paid" || status === "failed" || status === "cancelled" ? status : "pending";
}

export async function clearCart(userId: string): Promise<void> {
  await supabase.from("cart_items").delete().eq("user_id", userId);
}

export type CancellationRequestResult = {
  status: "requested";
  initiator: "retailer";
  refundPolicy: "manual_less_charges" | "not_required";
};

export async function requestOrderCancellation(
  orderId: string,
): Promise<CancellationRequestResult> {
  const { data, error } = await supabase.rpc("request_order_cancellation", { p_order_id: orderId });
  if (error) throw new Error(error.message || "The cancellation request could not be submitted.");
  if (!isRecord(data) || data.status !== "requested" || data.initiator !== "retailer") {
    throw new Error("The cancellation request was not confirmed.");
  }
  return data as CancellationRequestResult;
}

export async function confirmOrderDelivery(orderId: string): Promise<string> {
  const { data, error } = await supabase.rpc("confirm_order_delivery", { p_order_id: orderId });
  if (error) throw new Error(error.message || "Delivery could not be verified.");
  if (typeof data !== "string") throw new Error("Delivery verification was not confirmed.");
  return data;
}

export function orderTotal(order: RetailerOrder): number {
  return order.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
}

export function canCancelOrder(order: RetailerOrder): boolean {
  return (
    order.status !== "cancelled" &&
    !(order.status === "delivered" && order.delivery_verified_at) &&
    !order.cancel_requested
  );
}
