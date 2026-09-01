import { supabase } from "../../supabase.ts";

export type SupplierOrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";

export type SupplierOrderItem = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export type SupplierOrder = {
  id: string;
  status: SupplierOrderStatus;
  cancel_requested: boolean;
  cancellation_initiator: "retailer" | "supplier" | "admin" | "support" | null;
  cancellation_reason: string | null;
  payment_status: string;
  payment_method: string;
  delivery_verified_at: string | null;
  manual_refund_status: "not_required" | "review_required" | "pending" | "completed";
  supplier_can_cancel: boolean;
  notes: string | null;
  created_at: string;
  retailer_name: string;
  retailer_email: string;
  accepted_at: string | null;
  items: SupplierOrderItem[];
  supplier_total: number;
};

type SupplierOrderRow = Omit<
  SupplierOrder,
  "supplier_total" | "items" | "cancel_requested" | "accepted_at"
> & {
  supplier_total: number | string;
  cancel_requested: boolean | null;
  accepted_at: string | null;
  items: (Omit<SupplierOrderItem, "unit_price" | "line_total"> & {
    unit_price: number | string;
    line_total: number | string;
  })[];
};

function normalizeOrder(row: SupplierOrderRow): SupplierOrder {
  return {
    ...row,
    status: row.status as SupplierOrderStatus,
    cancel_requested: row.cancel_requested === true,
    accepted_at: row.accepted_at ?? null,
    supplier_total: Number(row.supplier_total),
    items: (row.items ?? []).map((item) => ({
      ...item,
      unit_price: Number(item.unit_price),
      line_total: Number(item.line_total),
    })),
  };
}

export async function loadSupplierOrders(): Promise<SupplierOrder[]> {
  const { data, error } = await supabase.rpc("supplier_orders");
  if (error) throw new Error(error.message);
  return ((Array.isArray(data) ? data : []) as SupplierOrderRow[]).map(normalizeOrder);
}

export async function acceptSupplierOrder(orderId: string): Promise<string> {
  const { data, error } = await supabase.rpc("seller_accept_order", {
    p_order_id: orderId,
  });
  if (error) throw new Error("The order could not be accepted.");
  if (typeof data !== "string") throw new Error("The order acceptance was not confirmed.");
  return data;
}

export async function requestSupplierCancellation(orderId: string, reason: string): Promise<void> {
  const { data, error } = await supabase.rpc("seller_request_order_cancellation", {
    p_order_id: orderId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message || "The cancellation request could not be submitted.");
  if (
    typeof data !== "object" ||
    data === null ||
    !("status" in data) ||
    data.status !== "requested"
  ) {
    throw new Error("The cancellation request was not confirmed.");
  }
}

export function canSupplierCancel(order: SupplierOrder): boolean {
  return (
    order.supplier_can_cancel &&
    order.status !== "cancelled" &&
    !(order.status === "delivered" && order.delivery_verified_at) &&
    !order.cancel_requested
  );
}

export function filterSupplierOrders(
  orders: readonly SupplierOrder[],
  searchTerm: string,
  shortId: (value: string) => string,
): SupplierOrder[] {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return [...orders];
  return orders.filter((order) =>
    [
      shortId(order.id),
      order.retailer_name,
      order.retailer_email,
      order.items.map((item) => item.product_name).join(" "),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}
