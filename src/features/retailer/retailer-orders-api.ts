import { supabase } from "../../supabase.ts";

export type RetailerOrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
export type PaymentStatus = "unpaid" | "paid" | "failed" | "cancelled";
export type DeliveryPaymentStatus = "unpaid" | "paid" | "failed" | "cancelled";
export type PaymentMethod = "online" | "cod";
export type CancellationInitiator = "retailer" | "supplier" | "admin" | "support" | null;
export type ManualRefundStatus = "not_required" | "review_required" | "pending" | "completed";

export type RetailerOrderItem = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  product_name: string;
  seller_id: string | null;
};

export type RetailerOrderPackage = {
  supplier_id: string;
  status: "pending" | "confirmed" | "declined" | "shipped" | "delivered";
  decline_reason: string | null;
};

export type RetailerShipmentEvent = {
  id: string;
  event_type: string;
  message: string;
  occurred_at: string;
};

export type RetailerShipment = {
  id: string;
  seller_id: string | null;
  carrier: string;
  tracking_number: string;
  tracking_url: string;
  status: string;
  notes: string;
  shipped_at: string;
  /** Newest first, ready for a timeline. */
  events: RetailerShipmentEvent[];
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
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  delivery_payment_status: DeliveryPaymentStatus;
  delivery_paid_at: string | null;
  manual_refund_status: ManualRefundStatus;
  refund_amount: number;
  platform_charge: number;
  delivery_charge: number;
  items: RetailerOrderItem[];
  packages: RetailerOrderPackage[];
  shipments: RetailerShipment[];
};

const ORDERS_SELECT =
  "id, status, cancel_requested, cancellation_initiator, payment_status, payment_method, tran_id, notes, created_at, delivery_verified_at, delivery_phone, delivery_address, delivery_city, delivery_postcode, delivery_payment_status, delivery_paid_at, manual_refund_status, refund_amount, platform_charge, delivery_charge, order_items(id, product_id, quantity, unit_price, seller_id, products(name)), order_supplier_acceptances(supplier_id, status, decline_reason), order_shipments(id, seller_id, carrier, tracking_number, tracking_url, status, notes, shipped_at, shipment_events(id, event_type, message, occurred_at))";

type OrderItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number | string;
  seller_id?: string | null;
  products: { name: string } | { name: string }[] | null;
};

type PackageRow = {
  supplier_id: string;
  status: string | null;
  decline_reason: string | null;
};

type ShipmentEventRow = {
  id: string;
  event_type: string | null;
  message: string;
  occurred_at: string;
};

type ShipmentRow = {
  id: string;
  seller_id?: string | null;
  carrier: string;
  tracking_number: string;
  tracking_url: string | null;
  status: string | null;
  notes: string | null;
  shipped_at: string | null;
  shipment_events?: ShipmentEventRow[] | null;
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
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  delivery_payment_status: string | null;
  delivery_paid_at: string | null;
  manual_refund_status: string | null;
  refund_amount: number | string | null;
  platform_charge: number | string | null;
  delivery_charge: number | string | null;
  order_items: OrderItemRow[] | null;
  order_supplier_acceptances?: PackageRow[] | null;
  order_shipments?: ShipmentRow[] | null;
};

function productName(relation: OrderItemRow["products"]): string {
  if (Array.isArray(relation)) return relation[0]?.name ?? "Unknown product";
  return relation?.name ?? "Unknown product";
}

function normalizeShipment(row: ShipmentRow): RetailerShipment {
  const events = (row.shipment_events ?? []).map((event) => ({
    id: event.id,
    event_type: event.event_type ?? "note",
    message: event.message,
    occurred_at: event.occurred_at,
  }));
  // Timelines read top-down, so newest first.
  events.sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at));
  return {
    id: row.id,
    seller_id: row.seller_id ?? null,
    carrier: row.carrier,
    tracking_number: row.tracking_number,
    tracking_url: row.tracking_url ?? "",
    status: row.status ?? "shipped",
    notes: row.notes ?? "",
    shipped_at: row.shipped_at ?? "",
    events,
  };
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
    delivery_phone: row.delivery_phone ?? null,
    delivery_address: row.delivery_address ?? null,
    delivery_city: row.delivery_city ?? null,
    delivery_postcode: row.delivery_postcode ?? null,
    delivery_payment_status: (row.delivery_payment_status ?? "unpaid") as DeliveryPaymentStatus,
    delivery_paid_at: row.delivery_paid_at ?? null,
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
      seller_id: item.seller_id ?? null,
    })),
    packages: (row.order_supplier_acceptances ?? []).map((pkg) => ({
      supplier_id: pkg.supplier_id,
      status:
        pkg.status === "confirmed" ||
        pkg.status === "declined" ||
        pkg.status === "shipped" ||
        pkg.status === "delivered"
          ? pkg.status
          : "pending",
      decline_reason: pkg.decline_reason,
    })),
    shipments: (row.order_shipments ?? []).map(normalizeShipment),
  };
}

export function packageStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Waiting on supplier";
    case "confirmed":
      return "Confirmed";
    case "shipped":
      return "Out for delivery";
    case "delivered":
      return "Delivered";
    case "declined":
      return "Cancelled by supplier";
    default:
      return status;
  }
}

/** Display label for the granular carrier shipment status on `order_shipments`. */
export function shipmentStatusLabel(status: string): string {
  switch (status) {
    case "shipped":
      return "Out for delivery";
    case "in_transit":
      return "In transit";
    case "out_for_delivery":
      return "Out for delivery";
    case "delivered":
      return "Delivered";
    case "exception":
      return "Delivery exception";
    default:
      return status;
  }
}

const SHIPMENT_STATUS_RANK: Record<string, number> = {
  exception: 0,
  out_for_delivery: 1,
  in_transit: 2,
  shipped: 3,
  delivered: 4,
};

/**
 * The parcel a retailer should look at first when an order carries several:
 * carrier problems, then the one closest to the door, newest first.
 */
export function primaryShipment(order: RetailerOrder): RetailerShipment | null {
  const ranked = [...order.shipments].sort((left, right) => {
    const byStatus =
      (SHIPMENT_STATUS_RANK[left.status] ?? 5) - (SHIPMENT_STATUS_RANK[right.status] ?? 5);
    if (byStatus !== 0) return byStatus;
    return Date.parse(right.shipped_at) - Date.parse(left.shipped_at);
  });
  return ranked[0] ?? null;
}

/** Whole days since the order was placed, floored at 0. */
export function deliveryAgeDays(order: RetailerOrder, now = Date.now()): number {
  const elapsed = now - Date.parse(order.created_at);
  return elapsed <= 0 ? 0 : Math.floor(elapsed / 86_400_000);
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

/** Distinct products in the retailer's cart — badges count products, not units. */
export async function loadCartCount(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("cart_items")
    .select("product_id, quantity")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { quantity: number }[]).filter((row) => row.quantity > 0).length;
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
  const paymentStatus = typeof payload?.paymentStatus === "string" ? payload.paymentStatus : "";
  const deliveryPaymentStatus =
    typeof payload?.deliveryPaymentStatus === "string" ? payload.deliveryPaymentStatus : "";
  if (paymentStatus === "paid" || deliveryPaymentStatus === "paid") return "paid";
  if (paymentStatus === "cancelled" || deliveryPaymentStatus === "cancelled") return "cancelled";
  if (paymentStatus === "failed" || deliveryPaymentStatus === "failed") return "failed";
  return "pending";
}

export async function clearCart(userId: string): Promise<void> {
  await supabase.from("cart_items").delete().eq("user_id", userId);
}

export type CancellationRequestResult = {
  status: "requested";
  initiator: "retailer";
  refundPolicy:
    | "manual_keep_delivery"
    | "manual_less_charges"
    | "delivery_not_refunded"
    | "delivery_refund_requestable"
    | "not_required";
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

export type CodDeliveryRefundResult = {
  id: string;
  manualRefundStatus: "pending";
  refundAmount: number;
};

export async function requestCodDeliveryRefund(orderId: string): Promise<CodDeliveryRefundResult> {
  const { data, error } = await supabase.rpc("request_cod_delivery_refund", {
    p_order_id: orderId,
  });
  if (error)
    throw new Error(error.message || "The delivery refund request could not be submitted.");
  const refundAmount = isRecord(data) ? Number(data.refundAmount) : NaN;
  if (!isRecord(data) || data.manualRefundStatus !== "pending" || !Number.isFinite(refundAmount)) {
    throw new Error("The delivery refund request was not confirmed.");
  }
  return {
    id: typeof data.id === "string" ? data.id : orderId,
    manualRefundStatus: "pending",
    refundAmount,
  };
}

export function orderMerchandiseTotal(order: RetailerOrder): number {
  return order.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
}

export function orderTotal(order: RetailerOrder): number {
  return orderMerchandiseTotal(order) + Number(order.delivery_charge ?? 0);
}

export function canCancelOrder(order: RetailerOrder): boolean {
  return (
    order.status !== "cancelled" &&
    !(order.status === "delivered" && order.delivery_verified_at) &&
    !order.cancel_requested
  );
}

export function canRequestCodDeliveryRefund(order: RetailerOrder): boolean {
  return (
    order.status === "cancelled" &&
    order.payment_method === "cod" &&
    order.delivery_payment_status === "paid" &&
    order.cancellation_initiator === "supplier" &&
    order.manual_refund_status === "not_required"
  );
}

/** True when the prepaid gateway amount (full total or COD delivery) is still outstanding. */
export function needsGatewayPaymentVerification(order: RetailerOrder): boolean {
  if (!order.tran_id) return false;
  if (order.payment_method === "cod") return order.delivery_payment_status === "unpaid";
  return order.payment_status === "unpaid";
}

export type OrderSort = "newest" | "oldest" | "total-desc";

export const ORDER_SORTS: { id: OrderSort; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "total-desc", label: "Highest total" },
];

export function parseOrderSort(value: string | null): OrderSort {
  return value === "oldest" || value === "total-desc" ? value : "newest";
}

export function sortOrders(orders: readonly RetailerOrder[], sort: OrderSort): RetailerOrder[] {
  const sorted = [...orders];
  switch (sort) {
    case "oldest":
      return sorted.sort(
        (left, right) => Date.parse(left.created_at) - Date.parse(right.created_at),
      );
    case "total-desc":
      return sorted.sort(
        (left, right) =>
          orderTotal(right) - orderTotal(left) ||
          Date.parse(right.created_at) - Date.parse(left.created_at),
      );
    default:
      return sorted.sort(
        (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
      );
  }
}

/**
 * One lowercase haystack per order for the search box: the short reference,
 * product names, notes, and the delivery address all match. Pure and cheap —
 * the list is client-side only.
 */
export function orderSearchText(order: RetailerOrder): string {
  return [
    order.id,
    order.items.map((item) => item.product_name),
    order.notes ?? "",
    order.delivery_address ?? "",
    order.delivery_city ?? "",
    order.delivery_phone ?? "",
  ]
    .flat()
    .join("\n")
    .toLowerCase();
}

export function filterOrdersByQuery(orders: readonly RetailerOrder[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return orders;
  // An order id is uppercase with dashes stripped for display, so also accept
  // the compact form ("31ba5db7" matches #31BA5DB7).
  const compact = needle.replaceAll("-", "");
  return orders.filter((order) => {
    const haystack = orderSearchText(order);
    return haystack.includes(needle) || (compact.length >= 4 && haystack.includes(compact));
  });
}
