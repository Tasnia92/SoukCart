/* -----------------------------------------------------------------------------
 * Admin dashboard contract — one purpose-built response for the operations
 * command center: SLA summary, action queue, operational KPIs, trend, and
 * recent records. Queue items always carry the record id so the overview can
 * open the exact order, dispute, or verification.
 * -----------------------------------------------------------------------------
 * `buildAdminDashboard` is pure, so the aggregation is unit tested without a
 * network. `loadAdminDashboard` composes the existing endpoints and degrades the
 * supplemental panels (disputes, verifications) instead of failing the page.
 * -------------------------------------------------------------------------- */

import { Clock3, MessageSquare, RefreshCw, ShieldCheck, type LucideIcon } from "lucide-react";
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
import { shortId } from "../orders/order-presentation.tsx";
import { formatPrice } from "../workspace/format.ts";
import {
  loadAdminActivity,
  orderCapturedTotal,
  orderRefundedTotal,
  type ActivityOrder,
} from "./admin-activity-api.ts";
import { loadAdminComplaints, type AdminComplaint } from "./admin-complaints-api.ts";
import { loadAdminOverviewUsers, type AdminOverviewUser } from "./admin-overview-api.ts";
import {
  loadSupplierVerifications,
  type AdminSupplierVerification,
} from "./admin-supplier-verifications-api.ts";

export const ADMIN_DISPUTES_SECTION = "Disputes";
export const ADMIN_VERIFICATIONS_SECTION = "Supplier verifications";

const SEVEN_DAYS = 7;
const HOUR_MS = 3_600_000;

export type AdminSlaBucket = "overdue" | "due_today" | "due_soon";

export type AdminQueueKind = "refund" | "cancellation" | "dispute" | "verification";

/** Target hours before an item is overdue, by queue kind. */
export const ADMIN_SLA_HOURS: Record<AdminQueueKind, number> = {
  refund: 24,
  cancellation: 24,
  dispute: 48,
  verification: 48,
};

export const ADMIN_SLA_LABELS: Record<AdminSlaBucket, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  due_soon: "Due soon",
};

export type AdminSummary = {
  /** Non-cancelled order totals in the window — GMV, not settled revenue. */
  orderValue: number;
  orderValueDelta: MetricDelta;
  /** Subset of order value where payment_status is paid. */
  paidOrderValue: number;
  /**
   * Money SoukCart is holding from orders placed in the window: payment
   * captured (online gateway, COD delivery prepaid, COD cash recorded) minus
   * every refund actually paid out. This is the revenue number.
   */
  collectedRevenue: number;
  /** Delivered + paid money in the window, net of return refunds. */
  settledRevenue: number;
  /** Refunds actually paid out for orders placed in the window. */
  refundedTotal: number;
  orders: number;
  ordersAwaitingAction: number;
  pendingOrders: number;
  cancellationRequests: number;
  refundsToComplete: number;
  refundsAtRisk: number;
  openDisputes: number;
  totalDisputes: number;
  accounts: number;
  accountsNeedingSetup: number;
  newAccounts: number;
  activeAccounts: number;
  pendingVerifications: number;
};

export type AdminSlaSummary = {
  overdue: number;
  dueToday: number;
  dueSoon: number;
  refundCount: number;
  refundAmount: number;
  cancellationCount: number;
  cancellationAmount: number;
  disputeCount: number;
  verificationCount: number;
};

export type AdminQueueItem = {
  id: string;
  kind: AdminQueueKind;
  recordId: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  severity: DashboardSeverity;
  marker: string;
  sla: AdminSlaBucket;
  at: string;
  amount: number | null;
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  hash?: string;
  actionLabel: string;
  batchable: boolean;
  order?: ActivityOrder;
  complaint?: AdminComplaint;
  verification?: AdminSupplierVerification;
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
  sla: AdminSlaSummary;
  /** One point per day across the window: `value` is order value (GMV), `count` is orders. */
  series: DashboardBucket[];
  queue: AdminQueueItem[];
  recent: AdminRecentOrder[];
  pendingVerifications: AdminSupplierVerification[];
  windowDays: number;
  failures: SectionFailure[];
};

export type AdminDashboardInput = {
  orders: readonly ActivityOrder[];
  users: readonly AdminOverviewUser[];
  complaints: readonly AdminComplaint[];
  verifications?: readonly AdminSupplierVerification[];
  failures?: readonly SectionFailure[];
};

function isCancelled(order: ActivityOrder): boolean {
  return order.status === "cancelled";
}

/** Non-cancelled orders count as GMV / order value. */
function isMerchandise(order: ActivityOrder): boolean {
  return !isCancelled(order);
}

function isPaidMerchandise(order: ActivityOrder): boolean {
  return isMerchandise(order) && order.payment_status === "paid";
}

export function awaitsConfirmation(order: ActivityOrder): boolean {
  return (
    order.status === "pending" &&
    !order.cancel_requested &&
    (order.payment_method === "cod" || order.payment_status === "paid")
  );
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

function startOfLocalDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function slaBucketFor(at: string, kind: AdminQueueKind, now: number): AdminSlaBucket {
  const created = new Date(at).getTime();
  const dueAt = created + ADMIN_SLA_HOURS[kind] * HOUR_MS;
  if (now >= dueAt) return "overdue";
  if (startOfLocalDay(dueAt) === startOfLocalDay(now)) return "due_today";
  return "due_soon";
}

function refundQueueItem(order: ActivityOrder, now: number): AdminQueueItem {
  const awaitingReview = order.manual_refund_status === "review_required";
  const sla = slaBucketFor(order.created_at, "refund", now);
  return {
    id: `refund-${order.id}`,
    kind: "refund",
    recordId: order.id,
    icon: RefreshCw,
    title: awaitingReview ? "Refund needs review" : "Refund payout pending",
    detail: `${order.retailer_name} · order #${shortId(order.id)} · ${formatPrice(order.refund_amount)}`,
    severity: "critical",
    marker: ageMarker(order.created_at, now),
    sla,
    at: order.created_at,
    amount: order.refund_amount,
    to: "/admin/order",
    search: { order: order.id },
    hash: `order-${order.id}`,
    actionLabel: awaitingReview ? "Review" : "Settle",
    batchable: order.manual_refund_status === "pending",
    order,
  };
}

function cancellationQueueItem(order: ActivityOrder, now: number): AdminQueueItem {
  return {
    id: `cancellation-${order.id}`,
    kind: "cancellation",
    recordId: order.id,
    icon: Clock3,
    title: `Cancellation requested by ${order.cancellation_initiator ?? "a participant"}`,
    detail: `${order.retailer_name} · order #${shortId(order.id)}${
      order.cancellation_reason ? ` · ${order.cancellation_reason}` : ""
    }`,
    severity: "attention",
    marker: ageMarker(order.created_at, now),
    sla: slaBucketFor(order.created_at, "cancellation", now),
    at: order.created_at,
    amount: order.total,
    to: "/admin/order",
    search: { order: order.id },
    hash: `order-${order.id}`,
    actionLabel: "Review",
    batchable: false,
    order,
  };
}

function disputeQueueItem(complaint: AdminComplaint, now: number): AdminQueueItem {
  return {
    id: `dispute-${complaint.id}`,
    kind: "dispute",
    recordId: complaint.id,
    icon: MessageSquare,
    title: complaint.subject,
    detail: `${complaint.retailer_name} · ${
      complaint.category === "cancellation_refund" ? "Cancellation & refund" : "General"
    }${complaint.order_id ? ` · order #${shortId(complaint.order_id)}` : ""}`,
    severity: "attention",
    marker: ageMarker(complaint.created_at, now),
    sla: slaBucketFor(complaint.created_at, "dispute", now),
    at: complaint.created_at,
    amount: null,
    to: "/admin/complaints",
    search: { complaint: complaint.id },
    hash: `complaint-${complaint.id}`,
    actionLabel: "Open",
    batchable: true,
    complaint,
  };
}

function verificationQueueItem(
  verification: AdminSupplierVerification,
  now: number,
): AdminQueueItem {
  return {
    id: `verification-${verification.user_id}`,
    kind: "verification",
    recordId: verification.user_id,
    icon: ShieldCheck,
    title: `${verification.shop_name} needs review`,
    detail: [verification.supplier_name, verification.trade_license_number, verification.location]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" · "),
    severity: "attention",
    marker: ageMarker(verification.created_at, now),
    sla: slaBucketFor(verification.created_at, "verification", now),
    at: verification.created_at,
    amount: null,
    to: "/admin/verifications/$userId",
    params: { userId: verification.user_id },
    actionLabel: "Review",
    batchable: false,
    verification,
  };
}

const QUEUE_RANK: Record<AdminQueueKind, number> = {
  refund: 0,
  cancellation: 1,
  dispute: 2,
  verification: 3,
};

const SLA_RANK: Record<AdminSlaBucket, number> = {
  overdue: 0,
  due_today: 1,
  due_soon: 2,
};

function summarizeSla(queue: readonly AdminQueueItem[]): AdminSlaSummary {
  const sla: AdminSlaSummary = {
    overdue: 0,
    dueToday: 0,
    dueSoon: 0,
    refundCount: 0,
    refundAmount: 0,
    cancellationCount: 0,
    cancellationAmount: 0,
    disputeCount: 0,
    verificationCount: 0,
  };

  for (const item of queue) {
    if (item.sla === "overdue") sla.overdue += 1;
    else if (item.sla === "due_today") sla.dueToday += 1;
    else sla.dueSoon += 1;

    if (item.kind === "refund") {
      sla.refundCount += 1;
      sla.refundAmount += item.amount ?? 0;
    } else if (item.kind === "cancellation") {
      sla.cancellationCount += 1;
      sla.cancellationAmount += item.amount ?? 0;
    } else if (item.kind === "dispute") sla.disputeCount += 1;
    else sla.verificationCount += 1;
  }

  return sla;
}

/**
 * Aggregates the admin overview. Money windows exclude cancelled orders (GMV);
 * paid order value is the paid subset. The queue is ordered by cost of delay,
 * then SLA, then newest-first.
 */
export function buildAdminDashboard(
  { orders, users, complaints, verifications = [], failures = [] }: AdminDashboardInput,
  now = Date.now(),
  windowDays = DEFAULT_WINDOW_DAYS,
): AdminDashboard {
  const merchandise = orders.filter(isMerchandise);
  const orderValueItems = merchandise.map((order) => ({
    at: order.created_at,
    value: order.total,
  }));
  const paidValueItems = orders
    .filter(isPaidMerchandise)
    .map((order) => ({ at: order.created_at, value: order.total }));
  const orderValue = sumWindow(orderValueItems, now, windowDays);
  const previousOrderValue = sumPreviousWindow(orderValueItems, now, windowDays);
  const paidOrderValue = sumWindow(paidValueItems, now, windowDays);

  // Revenue recognition (net cash): money joins the collected total when the
  // payment is captured, and leaves it when a refund is actually paid out.
  const capturedItems = orders.map((order) => ({
    at: order.created_at,
    value: orderCapturedTotal(order),
  }));
  const refundedItems = orders.map((order) => ({
    at: order.created_at,
    value: orderRefundedTotal(order),
  }));
  const settledItems = orders
    .filter((order) => order.status === "delivered" && order.payment_status === "paid")
    .map((order) => ({
      at: order.created_at,
      value: order.total + order.delivery_charge - orderRefundedTotal(order),
    }));
  const capturedValue = sumWindow(capturedItems, now, windowDays);
  const refundedTotal = sumWindow(refundedItems, now, windowDays);
  const settledRevenue = sumWindow(settledItems, now, windowDays);

  const pendingOrders = orders.filter(awaitsConfirmation);
  const cancellations = orders.filter(hasOpenCancellation);
  const refunds = orders.filter(needsRefundAction);
  const openDisputes = complaints.filter((complaint) => complaint.status === "open");
  const pendingVerifications = verifications.filter(
    (verification) => verification.status === "pending",
  );

  const awaitingAction = new Set<string>([
    ...cancellations.map((order) => order.id),
    ...refunds.map((order) => order.id),
  ]);

  const queue = [
    ...refunds.map((order) => refundQueueItem(order, now)),
    ...cancellations.map((order) => cancellationQueueItem(order, now)),
    ...openDisputes.map((complaint) => disputeQueueItem(complaint, now)),
    ...pendingVerifications.map((verification) => verificationQueueItem(verification, now)),
  ].sort(
    (left, right) =>
      QUEUE_RANK[left.kind] - QUEUE_RANK[right.kind] ||
      SLA_RANK[left.sla] - SLA_RANK[right.sla] ||
      Date.parse(right.at) - Date.parse(left.at),
  );

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
    .slice(0, 5);

  return {
    summary: {
      orderValue,
      orderValueDelta: periodDelta(orderValue, previousOrderValue, windowDays),
      paidOrderValue,
      collectedRevenue: capturedValue - refundedTotal,
      settledRevenue,
      refundedTotal,
      orders: merchandise.filter((order) => isWithinWindow(order.created_at, now, windowDays))
        .length,
      ordersAwaitingAction: awaitingAction.size,
      pendingOrders: pendingOrders.length,
      cancellationRequests: cancellations.length,
      refundsToComplete: refunds.length,
      refundsAtRisk: refunds.reduce((sum, order) => sum + order.refund_amount, 0),
      openDisputes: openDisputes.length,
      totalDisputes: complaints.length,
      accounts: users.length,
      accountsNeedingSetup: users.filter((user) => !user.role).length,
      newAccounts: users.filter((user) => isWithinWindow(user.created_at, now, SEVEN_DAYS)).length,
      activeAccounts: users.filter(
        (user) => user.last_sign_in_at && isWithinWindow(user.last_sign_in_at, now, windowDays),
      ).length,
      pendingVerifications: pendingVerifications.length,
    },
    sla: summarizeSla(queue),
    series: dailySeries(orderValueItems, now, windowDays),
    queue,
    recent,
    pendingVerifications,
    windowDays,
    failures: [...failures],
  };
}

export type AdminDashboardDeps = {
  loadActivity: typeof loadAdminActivity;
  loadUsers: typeof loadAdminOverviewUsers;
  loadComplaints: () => Promise<AdminComplaint[]>;
  loadVerifications: () => Promise<AdminSupplierVerification[]>;
};

const defaultDeps: AdminDashboardDeps = {
  loadActivity: loadAdminActivity,
  loadUsers: loadAdminOverviewUsers,
  loadComplaints: loadAdminComplaints,
  loadVerifications: loadSupplierVerifications,
};

/**
 * Loads the admin dashboard. Order activity and accounts are required — they carry
 * the KPI row. Disputes and verifications are supplemental: if they fail, their own
 * panel reports it and the rest of the dashboard still renders.
 */
export async function loadAdminDashboard(
  deps: AdminDashboardDeps = defaultDeps,
  now = Date.now(),
): Promise<AdminDashboard> {
  const [activity, users, disputes, verifications] = await Promise.all([
    deps.loadActivity(),
    deps.loadUsers(),
    optionalSection(ADMIN_DISPUTES_SECTION, [] as AdminComplaint[], deps.loadComplaints),
    optionalSection(
      ADMIN_VERIFICATIONS_SECTION,
      [] as AdminSupplierVerification[],
      deps.loadVerifications,
    ),
  ]);

  return buildAdminDashboard(
    {
      orders: activity.orders,
      users,
      complaints: disputes.value,
      verifications: verifications.value,
      failures: [disputes.failure, verifications.failure].filter(
        (failure): failure is SectionFailure => failure !== null,
      ),
    },
    now,
  );
}
