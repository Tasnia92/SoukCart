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

/**
 * Loads what the overview needs to paint: the retailer's orders and cart size.
 * Payment reconciliation deliberately stays out of this call — see
 * `reconcileRetailerPayments`.
 */
export async function loadRetailerOverview(
  retailerId: string,
  deps: Pick<RetailerOverviewDeps, "loadOrders" | "loadCart"> = defaultDeps,
): Promise<RetailerOverviewData> {
  const [orders, cartCount] = await Promise.all([
    deps.loadOrders(retailerId),
    deps.loadCart(retailerId),
  ]);
  return { orders, cartCount };
}

export type ReconciliationUpdate = {
  id: string;
  payment_status?: RetailerOrder["payment_status"];
  delivery_payment_status?: RetailerOrder["delivery_payment_status"];
};

export type ReconciliationResult = {
  /** Orders whose payment status the gateway actually changed. Empty when nothing moved. */
  updates: ReconciliationUpdate[];
  /** True when an order settled as paid, which also empties the cart. */
  cartCleared: boolean;
};

/**
 * Reconciles still-outstanding gateway checkouts (online full pay or COD delivery)
 * and clears the cart once one of them settles — the same behavior the old blocking
 * loader had, moved after first paint so a slow gateway can no longer delay the dashboard.
 * Each order is queried sequentially to keep the gateway request pattern unchanged.
 */
export async function reconcileRetailerPayments(
  retailerId: string,
  orders: readonly RetailerOrder[],
  deps: Pick<RetailerOverviewDeps, "queryPayment" | "clearRetailerCart"> = defaultDeps,
): Promise<ReconciliationResult> {
  const updates: ReconciliationResult["updates"] = [];
  let justPaid = false;

  for (const order of orders) {
    if (!order.tran_id) continue;
    const awaitingGateway =
      order.payment_method === "cod"
        ? order.delivery_payment_status === "unpaid"
        : order.payment_status === "unpaid";
    if (!awaitingGateway) continue;

    const result = await deps.queryPayment(order.tran_id);
    if (result === "paid" || result === "failed" || result === "cancelled") {
      if (order.payment_method === "cod") {
        updates.push({ id: order.id, delivery_payment_status: result });
      } else {
        updates.push({
          id: order.id,
          payment_status: result,
          delivery_payment_status: result,
        });
      }
      if (result === "paid") justPaid = true;
    }
  }

  if (justPaid) await deps.clearRetailerCart(retailerId);
  return { updates, cartCleared: justPaid };
}

/** Applies a reconciliation result without mutating the orders already on screen. */
export function applyReconciliation(
  orders: readonly RetailerOrder[],
  updates: ReconciliationResult["updates"],
): RetailerOrder[] {
  if (!updates.length) return [...orders];
  const byId = new Map(updates.map((update) => [update.id, update]));
  return orders.map((order) => {
    const patch = byId.get(order.id);
    return patch ? { ...order, ...patch, id: order.id } : order;
  });
}
