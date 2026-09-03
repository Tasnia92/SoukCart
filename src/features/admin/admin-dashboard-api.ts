/* -----------------------------------------------------------------------------
 * Admin dashboard contract — one purpose-built response for the operations
 * command center: `summary`, `series`, `queue`, `recent`, plus the notification
 * feed and account-setup totals.
 * -----------------------------------------------------------------------------
 * `buildAdminDashboard` is pure, so the aggregation is unit tested without a
 * network. `loadAdminDashboard` composes the existing endpoints and degrades the
 * supplemental panels (disputes, notifications) instead of failing the page.
 * -------------------------------------------------------------------------- */

import { Clock3, MessageSquare, RefreshCw, type LucideIcon } from "lucide-react";
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
import { loadNotifications, type OrderNotification } from "../notifications/notifications-api.ts";
import { shortId } from "../orders/order-presentation.tsx";
import { formatPrice } from "../workspace/format.ts";
import { loadAdminActivity, type ActivityOrder } from "./admin-activity-api.ts";
import { loadAdminComplaints, type AdminComplaint } from "./admin-complaints-api.ts";
import { loadAdminOverviewUsers, type AdminOverviewUser } from "./admin-overview-api.ts";

export const ADMIN_DISPUTES_SECTION = "Disputes";
export const ADMIN_NOTIFICATIONS_SECTION = "Notifications";

/** How many urgent items the queue shows before deferring to the full workflow. */
export const ADMIN_QUEUE_LIMIT = 6;
export const ADMIN_RECENT_LIMIT = 5;

const SEVEN_DAYS = 7;

export type AdminSummary = {
  revenue: number;
  revenueDelta: MetricDelta;
  orders: number;
  ordersAwaitingAction: number;
  pendingOrders: number;
  cancellationRequests: number;
  refundsToComplete: number;
  openDisputes: number;
  totalDisputes: number;
  accounts: number;
  accountsNeedingSetup: number;
  newAccounts: number;
  activeAccounts: number;
};

export type AdminQueueKind = "refund" | "cancellation" | "dispute";

export type AdminQueueItem = {
  id: string;
  kind: AdminQueueKind;
  icon: LucideIcon;
  title: string;
  detail: string;
  severity: DashboardSeverity;
  marker: string;
  at: string;
  to: string;
  actionLabel: string;
};

export type AdminRecentOrder = {
  id: string;
  retailerName: string;
  retailerEmail: string;
  createdAt: string;
  units: number;
  total: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  cancelRequested: boolean;
};

export type AdminDashboard = {
  summary: AdminSummary;
  /** One point per day across the window: `value` is revenue, `count` is orders. */
  series: DashboardBucket[];
  queue: AdminQueueItem[];
  recent: AdminRecentOrder[];
  notifications: OrderNotification[];
  windowDays: number;
  failures: SectionFailure[];
};

export type AdminDashboardInput = {
  orders: readonly ActivityOrder[];
  users: readonly AdminOverviewUser[];
  complaints: readonly AdminComplaint[];
  notifications: readonly OrderNotification[];
  failures?: readonly SectionFailure[];
};

function isCancelled(order: ActivityOrder): boolean {
  return order.status === "cancelled";
}

/** Orders whose money has not been voided; the only ones that count as revenue. */
function isEarning(order: ActivityOrder): boolean {
  return !isCancelled(order);
}

export function awaitsConfirmation(order: ActivityOrder): boolean {
  return order.status === "pending" && !order.cancel_requested;
}

export function hasOpenCancellation(order: ActivityOrder): boolean {
  return order.cancel_requested && order.status !== "cancelled";
}

export function needsRefundAction(order: ActivityOrder): boolean {
  return (
    order.manual_refund_status === "review_required" || order.manual_refund_status === "pending"
  );
}

function orderUnits(order: ActivityOrder): number {
  return order.lines.reduce((sum, line) => sum + line.quantity, 0);
}

function byCreatedAtDesc(left: { createdAt: string }, right: { createdAt: string }): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

function ageMarker(iso: string, now: number): string {
  const days = ageInDays(iso, now);
  if (days === 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

function refundQueueItem(order: ActivityOrder, now: number): AdminQueueItem {
  const awaitingReview = order.manual_refund_status === "review_required";
  return {
    id: `refund-${order.id}`,
    kind: "refund",
    icon: RefreshCw,
    title: awaitingReview ? "Refund needs review" : "Refund payout pending",
    detail: `${order.retailer_name} · order #${shortId(order.id)} · ${formatPrice(order.refund_amount)}`,
    severity: "critical",
    marker: ageMarker(order.created_at, now),
    at: order.created_at,
    to: "/admin/activity",
    actionLabel: "Settle",
  };
}

function cancellationQueueItem(order: ActivityOrder, now: number): AdminQueueItem {
  return {
    id: `cancellation-${order.id}`,
    kind: "cancellation",
    icon: Clock3,
    title: `Cancellation requested by ${order.cancellation_initiator ?? "a participant"}`,
    detail: `${order.retailer_name} · order #${shortId(order.id)}${
      order.cancellation_reason ? ` · ${order.cancellation_reason}` : ""
    }`,
    severity: "attention",
    marker: ageMarker(order.created_at, now),
    at: order.created_at,
    to: "/admin/activity",
    actionLabel: "Review",
  };
}

function disputeQueueItem(complaint: AdminComplaint, now: number): AdminQueueItem {
  return {
    id: `dispute-${complaint.id}`,
    kind: "dispute",
    icon: MessageSquare,
    title: complaint.subject,
    detail: `${complaint.retailer_name} · ${
      complaint.category === "cancellation_refund" ? "Cancellation & refund" : "General"
    }`,
    severity: "attention",
    marker: ageMarker(complaint.created_at, now),
    at: complaint.created_at,
    to: "/admin/complaints",
    actionLabel: "Open",
  };
}

const QUEUE_RANK: Record<AdminQueueKind, number> = { refund: 0, cancellation: 1, dispute: 2 };

/**
 * Aggregates the admin overview. Money windows exclude cancelled orders; the queue
 * is ordered by how expensive the delay is (refunds, then cancellations, then
 * disputes) and newest-first inside each group.
 */
export function buildAdminDashboard(
  { orders, users, complaints, notifications, failures = [] }: AdminDashboardInput,
  now = Date.now(),
  windowDays = DEFAULT_WINDOW_DAYS,
): AdminDashboard {
  const earning = orders.filter(isEarning);
  const revenueItems = earning.map((order) => ({ at: order.created_at, value: order.total }));
  const revenue = sumWindow(revenueItems, now, windowDays);
  const previousRevenue = sumPreviousWindow(revenueItems, now, windowDays);

  const pendingOrders = orders.filter(awaitsConfirmation);
  const cancellations = orders.filter(hasOpenCancellation);
  const refunds = orders.filter(needsRefundAction);
  const openDisputes = complaints.filter((complaint) => complaint.status === "open");

  const awaitingAction = new Set<string>([
    ...pendingOrders.map((order) => order.id),
    ...cancellations.map((order) => order.id),
    ...refunds.map((order) => order.id),
  ]);

  const queue = [
    ...refunds.map((order) => refundQueueItem(order, now)),
    ...cancellations.map((order) => cancellationQueueItem(order, now)),
    ...openDisputes.map((complaint) => disputeQueueItem(complaint, now)),
  ]
    .sort(
      (left, right) =>
        QUEUE_RANK[left.kind] - QUEUE_RANK[right.kind] ||
        Date.parse(right.at) - Date.parse(left.at),
    )
    .slice(0, ADMIN_QUEUE_LIMIT);

  const recent: AdminRecentOrder[] = orders
    .map((order) => ({
      id: order.id,
      retailerName: order.retailer_name,
      retailerEmail: order.retailer_email,
      createdAt: order.created_at,
      units: orderUnits(order),
      total: order.total,
      status: order.status,
      paymentStatus: order.payment_status,
      paymentMethod: order.payment_method,
      cancelRequested: order.cancel_requested,
    }))
    .sort(byCreatedAtDesc)
    .slice(0, ADMIN_RECENT_LIMIT);

  return {
    summary: {
      revenue,
      revenueDelta: periodDelta(revenue, previousRevenue, windowDays),
      orders: earning.filter((order) => isWithinWindow(order.created_at, now, windowDays)).length,
      ordersAwaitingAction: awaitingAction.size,
      pendingOrders: pendingOrders.length,
      cancellationRequests: cancellations.length,
      refundsToComplete: refunds.length,
      openDisputes: openDisputes.length,
      totalDisputes: complaints.length,
      accounts: users.length,
      // Preserves the legacy overview boundaries: roleless accounts, 7-day joins,
      // and a sign-in inside the trailing window.
      accountsNeedingSetup: users.filter((user) => !user.role).length,
      newAccounts: users.filter((user) => isWithinWindow(user.created_at, now, SEVEN_DAYS)).length,
      activeAccounts: users.filter(
        (user) => user.last_sign_in_at && isWithinWindow(user.last_sign_in_at, now, windowDays),
      ).length,
    },
    series: dailySeries(revenueItems, now, windowDays),
    queue,
    recent,
    notifications: [...notifications],
    windowDays,
    failures: [...failures],
  };
}

export type AdminDashboardDeps = {
  loadActivity: typeof loadAdminActivity;
  loadUsers: typeof loadAdminOverviewUsers;
  loadComplaints: () => Promise<AdminComplaint[]>;
  loadFeed: () => Promise<OrderNotification[]>;
};

const defaultDeps: AdminDashboardDeps = {
  loadActivity: loadAdminActivity,
  loadUsers: loadAdminOverviewUsers,
  loadComplaints: loadAdminComplaints,
  loadFeed: loadNotifications,
};

/**
 * Loads the admin dashboard. Order activity and accounts are required — they carry
 * the KPI row. Disputes and notifications are supplemental: if they fail, their own
 * panel reports it and the rest of the dashboard still renders.
 */
export async function loadAdminDashboard(
  deps: AdminDashboardDeps = defaultDeps,
  now = Date.now(),
): Promise<AdminDashboard> {
  const [activity, users, disputes, feed] = await Promise.all([
    deps.loadActivity(),
    deps.loadUsers(),
    optionalSection(ADMIN_DISPUTES_SECTION, [] as AdminComplaint[], deps.loadComplaints),
    optionalSection(ADMIN_NOTIFICATIONS_SECTION, [] as OrderNotification[], deps.loadFeed),
  ]);

  return buildAdminDashboard(
    {
      orders: activity.orders,
      users,
      complaints: disputes.value,
      notifications: feed.value,
      failures: [disputes.failure, feed.failure].filter(
        (failure): failure is SectionFailure => failure !== null,
      ),
    },
    now,
  );
}
