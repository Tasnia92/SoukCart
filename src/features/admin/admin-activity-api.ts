import { supabase } from "../../supabase.ts";
import { invokeAdmin } from "./admin-overview-api.ts";

export const ADMIN_ACTIVITY_FUNCTION = "admin-order-overview";

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export type ActivityLine = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  amount: number;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_email: string | null;
};

export type ActivityOrder = {
  id: string;
  status: string;
  cancel_requested: boolean;
  cancellation_initiator: "retailer" | "supplier" | "admin" | "support" | null;
  cancellation_reason: string | null;
  payment_status: string;
  payment_method: string;
  created_at: string;
  delivered_at: string | null;
  delivery_verified_at: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  platform_charge: number;
  delivery_charge: number;
  delivery_payment_status: "unpaid" | "paid" | "failed" | "cancelled";
  refund_amount: number;
  manual_refund_status: "not_required" | "review_required" | "pending" | "completed";
  refund_completed_at: string | null;
  retailer_id: string;
  retailer_name: string;
  retailer_email: string;
  total: number;
  lines: ActivityLine[];
};

export type ActivitySummary = {
  orders: number;
  revenue: number;
  retailers: number;
  suppliers: number;
  units: number;
};

export type ActivityResponse = {
  summary: ActivitySummary;
  orders: ActivityOrder[];
};

export type CancellationCharges = {
  platformCharge: number;
  deliveryCharge?: number;
};

export function orderPaidTotal(order: Pick<ActivityOrder, "total" | "delivery_charge">): number {
  return Math.max(order.total + order.delivery_charge, 0);
}

export async function loadAdminActivity(): Promise<ActivityResponse> {
  return invokeAdmin<ActivityResponse>({ action: "list" }, ADMIN_ACTIVITY_FUNCTION);
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  charges: CancellationCharges = { platformCharge: 0 },
): Promise<void> {
  await invokeAdmin<unknown>(
    {
      action: "update-status",
      orderId,
      status,
      platformCharge: charges.platformCharge,
      deliveryCharge: 0,
    },
    ADMIN_ACTIVITY_FUNCTION,
  );
}

export async function completeManualRefund(orderId: string): Promise<void> {
  await invokeAdmin<unknown>({ action: "complete-refund", orderId }, ADMIN_ACTIVITY_FUNCTION);
}

export function canFulfillOrder(
  order: Pick<ActivityOrder, "payment_method" | "payment_status" | "delivery_payment_status">,
): boolean {
  if (order.delivery_payment_status !== "paid") return false;
  return order.payment_method === "cod" || order.payment_status === "paid";
}

export function needsCodCollection(
  order: Pick<
    ActivityOrder,
    "payment_method" | "payment_status" | "delivery_payment_status" | "status"
  >,
): boolean {
  return (
    order.payment_method === "cod" &&
    order.delivery_payment_status === "paid" &&
    order.payment_status === "unpaid" &&
    order.status !== "pending" &&
    order.status !== "cancelled"
  );
}

export async function collectCodPayment(orderId: string): Promise<void> {
  const { error } = await supabase.rpc("collect_cod_payment", { p_order_id: orderId });
  if (error) throw new Error(error.message || "Cash collection could not be recorded.");
}

export const ADMIN_ORDER_VIEW_IDS = [
  "all",
  "pending",
  "confirmed",
  "shipped",
  "cancellations",
  "refunds",
  "cod",
] as const;

export type AdminOrderView = (typeof ADMIN_ORDER_VIEW_IDS)[number];

export function parseAdminOrderView(value: string | null): AdminOrderView {
  if (value && (ADMIN_ORDER_VIEW_IDS as readonly string[]).includes(value)) {
    return value as AdminOrderView;
  }
  return "all";
}

export function matchesAdminOrderView(order: ActivityOrder, view: AdminOrderView): boolean {
  switch (view) {
    case "all":
      return true;
    case "pending":
      return order.status === "pending";
    case "confirmed":
      return order.status === "confirmed";
    case "shipped":
      return order.status === "shipped";
    case "cancellations":
      return order.cancel_requested || order.status === "cancelled";
    case "refunds":
      return (
        order.manual_refund_status === "review_required" || order.manual_refund_status === "pending"
      );
    case "cod":
      return needsCodCollection(order);
  }
}

export function filterActivityOrders(
  orders: readonly ActivityOrder[],
  searchTerm: string,
  shortId: (value: string) => string,
  view: AdminOrderView = "all",
): ActivityOrder[] {
  const query = searchTerm.trim().toLowerCase();
  return orders.filter((order) => {
    if (!matchesAdminOrderView(order, view)) return false;
    if (!query) return true;
    if (
      shortId(order.id).toLowerCase().includes(query) ||
      `${order.retailer_name} ${order.retailer_email} ${order.cancellation_reason ?? ""}`
        .toLowerCase()
        .includes(query)
    ) {
      return true;
    }
    return order.lines.some((line) =>
      `${line.product_name} ${line.supplier_name ?? ""}`.toLowerCase().includes(query),
    );
  });
}
