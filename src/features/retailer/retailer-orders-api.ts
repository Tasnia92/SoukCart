import { supabase } from "../../supabase.ts";

export type RetailerOrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
export type PaymentStatus = "unpaid" | "paid" | "failed" | "cancelled";
export type PaymentMethod = "online" | "cod";

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
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  tran_id: string | null;
  notes: string | null;
  created_at: string;
  items: RetailerOrderItem[];
};

const ORDERS_SELECT =
  "id, status, cancel_requested, payment_status, payment_method, tran_id, notes, created_at, order_items(id, product_id, quantity, unit_price, products(name))";

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
  payment_status: string | null;
  payment_method: string | null;
  tran_id: string | null;
  notes: string | null;
  created_at: string;
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
    payment_status: (row.payment_status ?? "unpaid") as PaymentStatus,
    payment_method: (row.payment_method ?? "online") as PaymentMethod,
    tran_id: row.tran_id ?? null,
    notes: row.notes,
    created_at: row.created_at,
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

export async function requestOrderCancellation(
  orderId: string,
): Promise<"requested" | "cancelled"> {
  const { data, error } = await supabase.rpc("request_order_cancellation", { p_order_id: orderId });
  if (error) throw new Error("The order could not be cancelled.");
  return data === "requested" ? "requested" : "cancelled";
}

export function orderTotal(order: RetailerOrder): number {
  return order.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
}

export function canCancelOrder(order: RetailerOrder): boolean {
  return order.status === "pending" || (order.status === "confirmed" && !order.cancel_requested);
}
