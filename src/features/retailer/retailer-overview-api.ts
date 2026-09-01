import {
  clearCart,
  loadCartCount,
  loadRetailerOrders,
  queryPaymentStatus,
  type RetailerOrder,
} from "./retailer-orders-api.ts";

export type RetailerOverviewData = {
  orders: RetailerOrder[];
  cartCount: number;
};

export type RetailerOverviewDeps = {
  loadOrders: (retailerId: string) => Promise<RetailerOrder[]>;
  loadCart: (userId: string) => Promise<number>;
  queryPayment: (tranId: string) => Promise<"paid" | "failed" | "cancelled" | "pending">;
  clearRetailerCart: (userId: string) => Promise<void>;
};

const defaultDeps: RetailerOverviewDeps = {
  loadOrders: loadRetailerOrders,
  loadCart: loadCartCount,
  queryPayment: queryPaymentStatus,
  clearRetailerCart: clearCart,
};

// Preserves the legacy dashboard behavior: load orders and cart, sequentially reconcile
// every still-unpaid online order against the gateway, and clear the cart once any order
// becomes paid — all before the overview renders.
export async function loadRetailerOverview(
  retailerId: string,
  deps: RetailerOverviewDeps = defaultDeps,
): Promise<RetailerOverviewData> {
  const [orders, cartCount] = await Promise.all([
    deps.loadOrders(retailerId),
    deps.loadCart(retailerId),
  ]);

  let justPaid = false;
  for (const order of orders) {
    if (order.payment_status !== "unpaid" || !order.tran_id) continue;
    const result = await deps.queryPayment(order.tran_id);
    if (result === "paid" || result === "failed" || result === "cancelled") {
      order.payment_status = result;
      if (result === "paid") justPaid = true;
    }
  }

  if (justPaid) {
    await deps.clearRetailerCart(retailerId);
    return { orders, cartCount: 0 };
  }
  return { orders, cartCount };
}

export type RetailerOverviewStats = {
  orders: number;
  pending: number;
  delivered: number;
  inCart: number;
};

export function getRetailerOverviewStats(
  orders: readonly RetailerOrder[],
  cartCount: number,
): RetailerOverviewStats {
  return {
    orders: orders.length,
    pending: orders.filter((order) => order.status === "pending").length,
    delivered: orders.filter((order) => order.status === "delivered").length,
    inCart: cartCount,
  };
}
