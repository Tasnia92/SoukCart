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
  payment_status: string;
  payment_method: string;
  created_at: string;
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

export async function loadAdminActivity(): Promise<ActivityResponse> {
  return invokeAdmin<ActivityResponse>({ action: "list" }, ADMIN_ACTIVITY_FUNCTION);
}

export async function updateOrderStatus(orderId: string, status: string): Promise<void> {
  await invokeAdmin<unknown>({ action: "update-status", orderId, status }, ADMIN_ACTIVITY_FUNCTION);
}

export function filterActivityOrders(
  orders: readonly ActivityOrder[],
  searchTerm: string,
  shortId: (value: string) => string,
): ActivityOrder[] {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return [...orders];
  return orders.filter((order) => {
    if (
      shortId(order.id).toLowerCase().includes(query) ||
      `${order.retailer_name} ${order.retailer_email}`.toLowerCase().includes(query)
    ) {
      return true;
    }
    return order.lines.some((line) =>
      `${line.product_name} ${line.supplier_name ?? ""}`.toLowerCase().includes(query),
    );
  });
}
