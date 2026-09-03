/* -----------------------------------------------------------------------------
 * Retailer dashboard contract — ordering and delivery in one response: the single
 * `nextAction`, a `summary` of the trailing window, a `series` for spend, the
 * fulfillment `stages`, a short `recent` list and the help-ticket counts.
 * -----------------------------------------------------------------------------
 * `buildRetailerDashboard` is pure. `loadRetailerDashboard` fetches orders, cart and
 * tickets; payment reconciliation runs separately, after first paint.
 * -------------------------------------------------------------------------- */

import { Check, RefreshCw, ShoppingBag, ShoppingCart, Truck, type LucideIcon } from "lucide-react";
import {
  DEFAULT_WINDOW_DAYS,
  ageInDays,
  dailySeries,
  isWithinWindow,
  optionalSection,
  periodDelta,
  sumPreviousWindow,
  sumWindow,
  type DashboardBucket,
  type DashboardSeverity,
  type MetricDelta,
  type SectionFailure,
} from "../../components/dashboard/dashboard-model.ts";
import { loadRetailerComplaints, type RetailerComplaint } from "./retailer-complaints-api.ts";
import { orderTotal, type RetailerOrder } from "./retailer-orders-api.ts";
import { loadRetailerOverview } from "./retailer-overview-api.ts";

export const RETAILER_HELP_SECTION = "Help Center";
export const RETAILER_RECENT_LIMIT = 5;

/** The statuses a retailer still has something to wait on. */
export const ACTIVE_STATUSES = ["pending", "confirmed", "shipped"] as const;

export type RetailerNextActionKind =
  | "checkout"
  | "retry-payment"
  | "confirm-delivery"
  | "track"
  | "browse";

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

export type RetailerSummary = {
  spend: number;
  spendDelta: MetricDelta;
  activeOrders: number;
  delivered: number;
  cartUnits: number;
  orders: number;
};

export type RetailerStage = {
  key: string;
  label: string;
  count: number;
  severity: DashboardSeverity;
};

export type RetailerRecentOrder = {
  id: string;
  createdAt: string;
  units: number;
  total: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  cancelRequested: boolean;
  /** Delivered but not yet confirmed by the retailer, so the row still needs an action. */
  needsDeliveryConfirmation: boolean;
};

export type RetailerDashboard = {
  nextAction: RetailerNextAction;
  summary: RetailerSummary;
  /** One point per day: `value` is spend, `count` is orders placed. */
  series: DashboardBucket[];
  stages: RetailerStage[];
  recent: RetailerRecentOrder[];
  help: { open: number; resolved: number; total: number };
  windowDays: number;
  failures: SectionFailure[];
};

export type RetailerDashboardInput = {
  orders: readonly RetailerOrder[];
  cartUnits: number;
  complaints: readonly RetailerComplaint[];
  failures?: readonly SectionFailure[];
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

function units(order: RetailerOrder): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

function newestFirst(left: RetailerOrder, right: RetailerOrder): number {
  return Date.parse(right.created_at) - Date.parse(left.created_at);
}

/**
 * Picks the one thing worth doing next, in order of what costs the retailer most to
 * leave alone: an unpaid basket, a broken payment, an unconfirmed delivery, then a
 * shipment to watch. With none of those, the useful move is to browse.
 */
export function pickNextAction(
  orders: readonly RetailerOrder[],
  cartUnits: number,
  now = Date.now(),
): RetailerNextAction {
  if (cartUnits > 0) {
    return {
      kind: "checkout",
      eyebrow: "Next step",
      title: `Check out ${cartUnits} ${cartUnits === 1 ? "item" : "items"} in your cart`,
      copy: "Your basket is still open. Place the order to lock in current stock and pricing.",
      icon: ShoppingCart,
      severity: "attention",
      to: "/retailer/cart",
      actionLabel: "Go to cart",
    };
  }

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
      copy: "Verifying delivery closes the order and releases it from the cancellation window.",
      icon: Check,
      severity: "attention",
      to: "/retailer/orders",
      actionLabel: "Confirm delivery",
      orderId: unconfirmed.id,
    };
  }

  // The nearest active delivery is the oldest one still moving; it lands first.
  const tracking = [...orders].filter(isActive).sort((left, right) => -newestFirst(left, right))[0];
  if (tracking) {
    const age = ageInDays(tracking.created_at, now);
    return {
      kind: "track",
      eyebrow: "In progress",
      title: "Track your nearest delivery",
      copy: `Placed ${age === 0 ? "today" : `${age} ${age === 1 ? "day" : "days"} ago`}, currently ${tracking.status}.`,
      icon: Truck,
      severity: "neutral",
      to: "/retailer/orders",
      actionLabel: "Track order",
      orderId: tracking.id,
    };
  }

  return {
    kind: "browse",
    eyebrow: "Next step",
    title: "Build your next order",
    copy: "Nothing needs your attention. Browse supplier catalogs and start a new order.",
    icon: ShoppingBag,
    severity: "neutral",
    to: "/retailer/catalog",
    actionLabel: "Browse catalog",
  };
}

/** Aggregates the retailer overview. Spend windows exclude cancelled orders. */
export function buildRetailerDashboard(
  { orders, cartUnits, complaints, failures = [] }: RetailerDashboardInput,
  now = Date.now(),
  windowDays = DEFAULT_WINDOW_DAYS,
): RetailerDashboard {
  const spending = orders.filter(isSpend);
  const spendItems = spending.map((order) => ({
    at: order.created_at,
    value: orderTotal(order),
  }));
  const spend = sumWindow(spendItems, now, windowDays);
  const previousSpend = sumPreviousWindow(spendItems, now, windowDays);

  const countByStatus = (status: string) =>
    orders.filter((order) => order.status === status).length;

  const recent: RetailerRecentOrder[] = [...orders]
    .sort(newestFirst)
    .slice(0, RETAILER_RECENT_LIMIT)
    .map((order) => ({
      id: order.id,
      createdAt: order.created_at,
      units: units(order),
      total: orderTotal(order),
      status: order.status,
      paymentStatus: order.payment_status,
      paymentMethod: order.payment_method,
      cancelRequested: order.cancel_requested,
      needsDeliveryConfirmation: needsDeliveryConfirmation(order),
    }));

  const openTickets = complaints.filter((complaint) => complaint.status === "open").length;

  return {
    nextAction: pickNextAction(orders, cartUnits, now),
    summary: {
      spend,
      spendDelta: periodDelta(spend, previousSpend, windowDays),
      activeOrders: orders.filter(isActive).length,
      delivered: orders.filter(
        (order) =>
          order.status === "delivered" && isWithinWindow(order.created_at, now, windowDays),
      ).length,
      cartUnits,
      orders: spending.filter((order) => isWithinWindow(order.created_at, now, windowDays)).length,
    },
    series: dailySeries(spendItems, now, windowDays),
    stages: [
      {
        key: "pending",
        label: "Awaiting confirmation",
        count: countByStatus("pending"),
        severity: "attention",
      },
      {
        key: "confirmed",
        label: "Confirmed",
        count: countByStatus("confirmed"),
        severity: "neutral",
      },
      {
        key: "shipped",
        label: "On the way",
        count: countByStatus("shipped"),
        severity: "attention",
      },
      {
        key: "delivered",
        label: "Delivered",
        count: countByStatus("delivered"),
        severity: "positive",
      },
      {
        key: "cancelled",
        label: "Cancelled",
        count: countByStatus("cancelled"),
        severity: "critical",
      },
    ],
    recent,
    help: {
      open: openTickets,
      resolved: complaints.length - openTickets,
      total: complaints.length,
    },
    windowDays,
    failures: [...failures],
  };
}

export type RetailerDashboardDeps = {
  loadOverview: typeof loadRetailerOverview;
  loadTickets: (retailerId: string) => Promise<RetailerComplaint[]>;
};

const defaultDeps: RetailerDashboardDeps = {
  loadOverview: loadRetailerOverview,
  loadTickets: loadRetailerComplaints,
};

/**
 * Loads everything the retailer dashboard aggregates. Returns the *input* rather than
 * the built dashboard so the page keeps the raw orders it needs for payment
 * reconciliation and can rebuild locally without another round trip.
 *
 * Orders and cart are required; help tickets are supplemental, so a Help Center
 * failure degrades that one widget instead of the page.
 */
export async function loadRetailerDashboardInput(
  retailerId: string,
  deps: RetailerDashboardDeps = defaultDeps,
): Promise<RetailerDashboardInput & { orders: RetailerOrder[] }> {
  const [overview, tickets] = await Promise.all([
    deps.loadOverview(retailerId),
    optionalSection(RETAILER_HELP_SECTION, [] as RetailerComplaint[], () =>
      deps.loadTickets(retailerId),
    ),
  ]);

  return {
    orders: overview.orders,
    cartUnits: overview.cartCount,
    complaints: tickets.value,
    failures: tickets.failure ? [tickets.failure] : [],
  };
}
