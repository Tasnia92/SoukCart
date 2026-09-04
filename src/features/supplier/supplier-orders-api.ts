import { supabase } from "../../supabase.ts";

export type SupplierOrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";

export type SupplierOrderItem = {
  id: string;
  product_id: string;
  product_name: string;
  unit?: string;
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
  delivery_charge: number;
  delivery_payment_status: "unpaid" | "paid" | "failed" | "cancelled";
  delivery_paid_at: string | null;
  delivery_verified_at: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  manual_refund_status: "not_required" | "review_required" | "pending" | "completed";
  supplier_can_cancel: boolean;
  notes: string | null;
  created_at: string;
  retailer_name: string;
  retailer_email: string;
  accepted_at: string | null;
  package_status: "pending" | "confirmed" | "declined" | "shipped" | "delivered";
  declined_at: string | null;
  decline_reason: string | null;
  items: SupplierOrderItem[];
  supplier_total: number;
};

type SupplierOrderRow = Omit<
  SupplierOrder,
  | "supplier_total"
  | "items"
  | "cancel_requested"
  | "accepted_at"
  | "package_status"
  | "declined_at"
  | "delivery_charge"
  | "delivery_payment_status"
  | "delivery_paid_at"
> & {
  supplier_total: number | string;
  delivery_charge?: number | string | null;
  delivery_payment_status?: string | null;
  delivery_paid_at?: string | null;
  cancel_requested: boolean | null;
  accepted_at: string | null;
  package_status?: string | null;
  declined_at?: string | null;
  decline_reason?: string | null;
  items: (Omit<SupplierOrderItem, "unit_price" | "line_total"> & {
    unit_price: number | string;
    line_total: number | string;
  })[];
};

function normalizeOrder(row: SupplierOrderRow): SupplierOrder {
  const deliveryStatus = row.delivery_payment_status;
  return {
    ...row,
    status: row.status as SupplierOrderStatus,
    cancel_requested: row.cancel_requested === true,
    accepted_at: row.accepted_at ?? null,
    package_status:
      row.package_status === "confirmed" ||
      row.package_status === "declined" ||
      row.package_status === "shipped" ||
      row.package_status === "delivered"
        ? row.package_status
        : "pending",
    declined_at: row.declined_at ?? null,
    decline_reason: row.decline_reason ?? null,
    delivery_charge: Number(row.delivery_charge ?? 0),
    delivery_payment_status:
      deliveryStatus === "paid" || deliveryStatus === "failed" || deliveryStatus === "cancelled"
        ? deliveryStatus
        : "unpaid",
    delivery_paid_at: row.delivery_paid_at ?? null,
    delivery_phone: row.delivery_phone ?? null,
    delivery_address: row.delivery_address ?? null,
    delivery_city: row.delivery_city ?? null,
    delivery_postcode: row.delivery_postcode ?? null,
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

export async function setSupplierOrderStatus(orderId: string): Promise<"confirmed"> {
  const { data, error } = await supabase.rpc("seller_set_order_status", {
    p_order_id: orderId,
    p_status: "confirmed",
  });
  if (error) throw new Error(error.message || "The order status could not be updated.");
  if (data !== "confirmed") {
    throw new Error("The order status was not updated.");
  }
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

export function canFulfillPayment(
  order: Pick<SupplierOrder, "payment_method" | "payment_status" | "delivery_payment_status">,
): boolean {
  if (order.delivery_payment_status !== "paid") return false;
  return order.payment_method === "cod" || order.payment_status === "paid";
}

export function canConfirmOrder(order: SupplierOrder): boolean {
  return order.package_status === "pending" && !order.cancel_requested && canFulfillPayment(order);
}

export function canDeclineOrderItems(order: SupplierOrder): boolean {
  return (
    order.package_status === "pending" &&
    !order.cancel_requested &&
    order.status !== "cancelled" &&
    canFulfillPayment(order)
  );
}

export async function declineSupplierItems(orderId: string, reason: string): Promise<void> {
  const { data, error } = await supabase.rpc("seller_decline_order_items", {
    p_order_id: orderId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message || "These items could not be declined.");
  if (
    typeof data !== "object" ||
    data === null ||
    !("packageStatus" in data) ||
    data.packageStatus !== "declined"
  ) {
    throw new Error("The items were not declined.");
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
