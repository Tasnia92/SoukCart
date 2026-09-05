/* -----------------------------------------------------------------------------
 * Retailer dashboard contract — the "buy & track" cockpit: one next action, a
 * quiet stat line, the active-shipments strip and a one-click reorder target.
 * `buildRetailerDashboard` is pure. `loadRetailerDashboardInput` fetches orders
 * and the cart; payment reconciliation runs separately, after first paint.
 * -------------------------------------------------------------------------- */

import { Check, RefreshCw, ShoppingBag, type LucideIcon } from "lucide-react";
import {
  DEFAULT_WINDOW_DAYS,
  ageInDays,
  isWithinWindow,
  sumWindow,
  type DashboardSeverity,
} from "../../components/dashboard/dashboard-model.ts";
import { orderTotal, primaryShipment, type RetailerOrder } from "./retailer-orders-api.ts";
import { loadRetailerOverview } from "./retailer-overview-api.ts";

/** The statuses a retailer still has something to wait on. */
export const ACTIVE_STATUSES = ["pending", "confirmed", "shipped"] as const;

export type RetailerNextActionKind = "retry-payment" | "confirm-delivery" | "browse";

export type RetailerNextAction = {
  kind: RetailerNextActionKind;
  eyebrow: string;
  title: string;
  copy: string;
  icon: LucideIcon;
  severity: DashboardSeverity;
  to: string;
  actionLabel: string;
  /** Present when the action points at one specific order. */
  orderId?: string;
};

export type RetailerShipmentCard = {
  orderId: string;
  /** Whole-order fulfillment status. */
  status: string;
  /** Whole days since the order was placed. */
  ageDays: number;
  /** Supplier packages on the order (at least one). */
  packageCount: number;
  /** Set once at least one parcel has been handed to a carrier. */
  shipment: {
    carrier: string;
    trackingNumber: string;
    trackingUrl: string;
    status: string;
  } | null;
};

export type RetailerSummary = {
  spend: number;
  activeOrders: number;
  delivered: number;
  cartItems: number;
  orders: number;
};

export type RetailerDashboard = {
  nextAction: RetailerNextAction;
  summary: RetailerSummary;
  /** Active orders oldest first — the one that lands soonest leads the strip. */
  shipments: RetailerShipmentCard[];
  /** The most recent delivered order, for one-click reorder. */
  reorderOrderId: string | null;
  windowDays: number;
};

export type RetailerDashboardInput = {
  orders: readonly RetailerOrder[];
  cartItems: number;
};

function isActive(order: RetailerOrder): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(order.status);
}

function isSpend(order: RetailerOrder): boolean {
  return order.status !== "cancelled";
}

export function needsDeliveryConfirmation(order: RetailerOrder): boolean {
  return order.status === "delivered" && !order.delivery_verified_at;
}

export function hasFailedPayment(order: RetailerOrder): boolean {
  return (
    order.status !== "cancelled" &&
    (order.payment_status === "failed" || order.payment_status === "cancelled")
  );
}

function newestFirst(left: RetailerOrder, right: RetailerOrder): number {
  return Date.parse(right.created_at) - Date.parse(left.created_at);
}

/**
 * Picks the one thing worth doing next, in order of what costs the retailer most to
 * leave alone: a broken payment, an unconfirmed delivery. An open basket never
 * claims the slot — the cart button and sidebar badge already count it, so adding
 * to the cart stays quiet. With nothing to fix, the useful move is to browse —
 * active parcels already have the shipments strip, so tracking never needs to
 * compete for the hero slot.
 */
export function pickNextAction(orders: readonly RetailerOrder[]): RetailerNextAction {
  const failed = [...orders].filter(hasFailedPayment).sort(newestFirst)[0];
  if (failed) {
    return {
      kind: "retry-payment",
      eyebrow: "Needs attention",
      title: "A payment did not go through",
      copy: "This order will not be dispatched until the payment is settled. Retry it or switch to cash on delivery.",
      icon: RefreshCw,
      severity: "critical",
      to: "/retailer/orders",
      actionLabel: "Review order",
      orderId: failed.id,
    };
  }

  const unconfirmed = [...orders].filter(needsDeliveryConfirmation).sort(newestFirst)[0];
  if (unconfirmed) {
    return {
      kind: "confirm-delivery",
      eyebrow: "Next step",
      title: "Confirm a delivery you received",
      copy: "Verifying delivery confirms you received the parcel. Delivered orders can no longer be cancelled or refunded.",
      icon: Check,
      severity: "attention",
      to: "/retailer/orders",
      actionLabel: "Confirm delivery",
      orderId: unconfirmed.id,
    };
  }

  return {
    kind: "browse",
    eyebrow: "Next step",
    title: "Build your next order",
    copy: "Nothing needs your attention. Browse supplier catalogs and start a new order.",
    icon: ShoppingBag,
    severity: "neutral",
    to: "/retailer",
    actionLabel: "Browse products",
  };
}

/** Aggregates the cockpit. Spend windows exclude cancelled orders. */
export function buildRetailerDashboard(
  { orders, cartItems }: RetailerDashboardInput,
  now = Date.now(),
  windowDays = DEFAULT_WINDOW_DAYS,
): RetailerDashboard {
  const spending = orders.filter(isSpend);
  const spend = sumWindow(
    spending.map((order) => ({ at: order.created_at, value: orderTotal(order) })),
    now,
    windowDays,
  );

  const activeOrders = orders.filter(isActive);
  const reorder = [...orders].filter((order) => order.status === "delivered").sort(newestFirst)[0];

  return {
    nextAction: pickNextAction(orders),
    summary: {
      spend,
      activeOrders: activeOrders.length,
      delivered: orders.filter(
        (order) =>
          order.status === "delivered" && isWithinWindow(order.created_at, now, windowDays),
      ).length,
      cartItems,
      orders: spending.filter((order) => isWithinWindow(order.created_at, now, windowDays)).length,
    },
    shipments: buildShipmentCards(orders, now),
    reorderOrderId: reorder?.id ?? null,
    windowDays,
  };
}

/**
 * The active-parcels strip: one card per pending/confirmed/shipped order,
 * oldest first — the one that lands soonest leads.
 */
export function buildShipmentCards(
  orders: readonly RetailerOrder[],
  now = Date.now(),
): RetailerShipmentCard[] {
  return orders
    .filter(isActive)
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))
    .map((order) => {
      const shipment = primaryShipment(order);
      return {
        orderId: order.id,
        status: order.status,
        ageDays: ageInDays(order.created_at, now),
        packageCount: Math.max(order.packages.length, 1),
        shipment: shipment
          ? {
              carrier: shipment.carrier,
              trackingNumber: shipment.tracking_number,
              trackingUrl: shipment.tracking_url,
              status: shipment.status,
            }
          : null,
      };
    });
}

export type RetailerDashboardDeps = {
  loadOverview: typeof loadRetailerOverview;
};

const defaultDeps: RetailerDashboardDeps = {
  loadOverview: loadRetailerOverview,
};

/**
 * Loads everything the cockpit aggregates. Returns the *input* rather than the
 * built dashboard so the page keeps the raw orders it needs for payment
 * reconciliation and can rebuild locally without another round trip.
 */
export async function loadRetailerDashboardInput(
  retailerId: string,
  deps: RetailerDashboardDeps = defaultDeps,
): Promise<RetailerDashboardInput> {
  const overview = await deps.loadOverview(retailerId);
  return { orders: overview.orders, cartItems: overview.cartCount };
}
