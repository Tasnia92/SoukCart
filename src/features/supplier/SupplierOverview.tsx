import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Clock,
  Layers,
  Package,
  Plus,
  RefreshCw,
  Truck,
  Wallet,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  ActionQueue,
  DashboardCard,
  DashboardLink,
  DashboardRow,
  DashboardSkeleton,
  DashboardTable,
  HealthWidget,
  MetricCard,
  SectionEmpty,
  type ActionQueueEntry,
  type DashboardColumn,
  type HealthItem,
} from "../../components/dashboard/Dashboard.tsx";
import { TrendChartCard } from "../../components/dashboard/DashboardCharts.tsx";
import type { DashboardBucket } from "../../components/dashboard/dashboard-model.ts";
import { InlineNotice, PageHeader, WorkspaceError } from "../../components/ui/Workspace.tsx";
import { useProductChanges } from "../../product-realtime.ts";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { useTableChanges } from "../../workspace-realtime.ts";
import { PaymentBadge, shortId, StatusBadge } from "../orders/order-presentation.tsx";
import { firstName, formatPrice, formatUpdatedAt } from "../workspace/format.ts";
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import {
  loadSupplierDashboard,
  LOW_STOCK_THRESHOLD,
  type SupplierDashboard,
  type SupplierQueueOrder,
} from "./supplier-dashboard-api.ts";
import { consumeSupplierNotice, SupplierWorkspaceShell } from "./supplier-shared.tsx";

type SupplierOverviewProps = {
  loadDashboard?: (sellerId: string, windowDays: number) => Promise<SupplierDashboard>;
};

type Freshness = "current" | "refreshing" | "stale";

/** Stock and product edits can fire several row events; batch them into one reload. */
const REALTIME_COALESCE_MS = 400;
const ORDER_LIVE_TABLES = ["orders", "seller_payouts"] as const;

/** Fixed reporting window for the chart and summary; realtime keeps it current. */
const OVERVIEW_WINDOW_DAYS = 30;

/**
 * Stable module-level default. An inline default parameter recreates a new function
 * every render; because the load effect depends on `loadDashboard`, that caused the
 * seller dashboard to refresh in a loop after login.
 */
function defaultLoadDashboard(sellerId: string, windowDays: number): Promise<SupplierDashboard> {
  return loadSupplierDashboard(sellerId, undefined, Date.now(), windowDays);
}

function seriesRange(series: readonly DashboardBucket[]): string {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return "No period";
  return `${first.label} – ${last.label} · daily`;
}

function ageLabel(days: number): string {
  if (days === 0) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

const queueColumns: DashboardColumn<SupplierQueueOrder>[] = [
  {
    key: "order",
    header: "Order",
    cell: (order) => <span className="font-medium">#{shortId(order.id)}</span>,
  },
  {
    key: "retailer",
    header: "Retailer",
    cell: (order) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{order.retailerName}</span>
        <span className="truncate text-xs text-muted-foreground">{order.retailerEmail}</span>
      </span>
    ),
  },
  { key: "units", header: "Units", numeric: true, cell: (order) => order.units },
  {
    key: "value",
    header: "Order value",
    numeric: true,
    cell: (order) => <span className="font-medium">{formatPrice(order.total)}</span>,
  },
  {
    key: "status",
    header: "Status",
    cell: (order) => (
      <div className="flex flex-wrap items-center gap-1">
        <StatusBadge status={order.status} />
        {order.cancelRequested ? <Badge variant="destructive">Cancel requested</Badge> : null}
        <PaymentBadge paymentStatus={order.paymentStatus} paymentMethod={order.paymentMethod} />
      </div>
    ),
  },
  {
    key: "age",
    header: "Waiting",
    cell: (order) =>
      order.ageDays >= 1 ? (
        <strong>{ageLabel(order.ageDays)}</strong>
      ) : (
        <span>{ageLabel(order.ageDays)}</span>
      ),
  },
  {
    key: "action",
    header: "Action",
    cell: (order) => (
      <RouterLink
        className="inline-flex items-center gap-1 font-medium"
        to="/supplier/orders"
        search={
          order.cancelRequested
            ? { filter: "cancellation-requested" }
            : order.status === "confirmed"
              ? { filter: "to-ship" }
              : { filter: "to-confirm" }
        }
      >
        <span>{order.cancelRequested ? "Review" : "Process order"}</span>
        <ArrowRight aria-hidden="true" />
      </RouterLink>
    ),
  },
];

function stockHealthItems(dashboard: SupplierDashboard): HealthItem[] {
  return dashboard.stockRisk.map((product) => ({
    id: product.id,
    title: product.name,
    detail:
      product.stock <= 0 ? "Out of stock — restock to resume sales" : `Low on ${product.unit}s`,
    marker: product.stock <= 0 ? "0 left" : `${product.stock} left`,
    severity: product.severity,
    to: "/supplier/stock",
    actionLabel: "Restock",
  }));
}

function focusItems(dashboard: SupplierDashboard): ActionQueueEntry[] {
  const { summary } = dashboard;
  const items: ActionQueueEntry[] = [];

  if (summary.cancellationRequests > 0) {
    items.push({
      id: "cancellations",
      icon: CircleAlert,
      title: `${summary.cancellationRequests} cancellation request${summary.cancellationRequests === 1 ? "" : "s"}`,
      detail: "Review the affected orders before continuing fulfillment.",
      severity: "critical",
      marker: "Urgent",
      to: "/supplier/orders",
      search: { filter: "cancellation-requested" },
      actionLabel: "Review",
    });
  }

  if (summary.toConfirm > 0) {
    items.push({
      id: "to-confirm",
      icon: Clock,
      title: `${summary.toConfirm} order${summary.toConfirm === 1 ? "" : "s"} to confirm`,
      detail: "Paid or COD orders waiting for your confirmation.",
      severity: summary.cancellationRequests > 0 ? "critical" : "attention",
      marker: "To confirm",
      to: "/supplier/orders",
      search: { filter: "to-confirm" },
      actionLabel: "Confirm",
    });
  }

  if (summary.toShip > 0) {
    items.push({
      id: "to-ship",
      icon: Truck,
      title: `${summary.toShip} order${summary.toShip === 1 ? "" : "s"} waiting on delivery`,
      detail: "Confirmed. Admin will mark these shipped and delivered.",
      severity: "attention",
      marker: "Waiting",
      to: "/supplier/orders",
      search: { filter: "to-ship" },
      actionLabel: "View",
    });
  }

  if (summary.awaitingPayment > 0) {
    items.push({
      id: "awaiting-payment",
      icon: Wallet,
      title: `${summary.awaitingPayment} awaiting payment`,
      detail: "Online orders that still need retailer payment before fulfillment.",
      severity: "neutral",
      marker: "Unpaid",
      to: "/supplier/orders",
      search: { filter: "awaiting-payment" },
      actionLabel: "View",
    });
  }

  if (summary.outOfStock > 0) {
    items.push({
      id: "out-of-stock",
      icon: Layers,
      title: `${summary.outOfStock} out of stock`,
      detail: `${summary.lowStock} more listing${summary.lowStock === 1 ? "" : "s"} running low.`,
      severity: "critical",
      marker: `${summary.outOfStock} empty`,
      to: "/supplier/stock",
      actionLabel: "Restock",
    });
  } else if (summary.stockAtRisk > 0) {
    items.push({
      id: "inventory",
      icon: Layers,
      title: `${summary.stockAtRisk} listing${summary.stockAtRisk === 1 ? "" : "s"} at risk`,
      detail: `${summary.lowStock} running at or below ${LOW_STOCK_THRESHOLD} units.`,
      severity: "attention",
      marker: "Low stock",
      to: "/supplier/stock",
      actionLabel: "Restock",
    });
  }

  return items.slice(0, 5);
}

export function SupplierOverview({ loadDashboard = defaultLoadDashboard }: SupplierOverviewProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier" });
  const [dashboard, setDashboard] = useState<SupplierDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [freshness, setFreshness] = useState<Freshness>("refreshing");
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [notice] = useState(consumeSupplierNotice);
  const dashboardRef = useRef<SupplierDashboard | null>(null);
  dashboardRef.current = dashboard;

  const sellerId = state.status === "seller" ? state.session.user.id : "";
  const invalidate = useCallback(() => setLoadVersion((version) => version + 1), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useProductChanges({
    enabled: Boolean(sellerId),
    sellerId,
    onChange: invalidate,
    coalesceMs: REALTIME_COALESCE_MS,
  });

  useTableChanges({
    enabled: Boolean(sellerId) && Boolean(dashboard) && !error,
    tables: ORDER_LIVE_TABLES,
    onChange: invalidate,
    coalesceMs: 1500,
  });

  useEffect(() => {
    if (!sellerId) return;
    let current = true;
    const hasData = dashboardRef.current !== null;
    if (hasData) {
      setFreshness("refreshing");
    } else {
      setError(null);
    }

    void loadDashboard(sellerId, OVERVIEW_WINDOW_DAYS)
      .then((next) => {
        if (!current) return;
        setDashboard(next);
        setUpdatedAt(Date.now());
        setFreshness("current");
        setError(null);
        setRefreshError(null);
      })
      .catch((loadError: unknown) => {
        if (!current) return;
        const message = loadError instanceof Error ? loadError.message : "Please try again.";
        if (dashboardRef.current) {
          setFreshness("stale");
          setRefreshError(message);
        } else {
          setError(message);
        }
      });

    return () => {
      current = false;
    };
  }, [loadDashboard, loadVersion, sellerId]);

  if (state.status !== "seller") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const userName = state.profile.name || state.profile.email;

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Seller workspace"
        title="We could not load your dashboard."
        message={error}
        onRetry={invalidate}
        onLogout={onLogout}
      />
    );
  }

  const summary = dashboard?.summary;
  const priorities = dashboard ? focusItems(dashboard) : [];
  const loading = freshness === "refreshing";

  return (
    <SupplierWorkspaceShell
      section="overview"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Seller dashboard"
        title={`Welcome back, ${firstName(userName)}.`}
        copy="See what needs attention first, then track sales, payouts, and inventory performance."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {updatedAt ? (
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {freshness === "refreshing" ? "Refreshing…" : formatUpdatedAt(updatedAt, nowTick)}
              </span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Refresh"
              title="Refresh"
              disabled={loading && !dashboard}
              onClick={invalidate}
            >
              {loading && dashboard ? <Spinner /> : <RefreshCw aria-hidden="true" />}
            </Button>
            <Button asChild variant="outline">
              <RouterLink to="/supplier/products/new">
                <Plus data-icon="inline-start" />
                Add product
              </RouterLink>
            </Button>
            <Button asChild>
              <RouterLink to="/supplier/orders" search={{ filter: "action" }}>
                <Package data-icon="inline-start" />
                Process orders
              </RouterLink>
            </Button>
          </div>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {freshness === "stale" && refreshError ? (
        <Alert variant="destructive" role="status">
          <AlertTitle>Couldn’t refresh—showing older data</AlertTitle>
          <AlertDescription>{refreshError}</AlertDescription>
        </Alert>
      ) : null}

      {dashboard && summary ? (
        <>
          <DashboardRow split="7-5">
            <DashboardCard
              eyebrow="Your focus"
              title="What needs attention"
              meta={
                priorities.length
                  ? `${priorities.length} priorit${priorities.length === 1 ? "y" : "ies"} across orders and inventory`
                  : "Your store is caught up"
              }
              severity={
                priorities.some((item) => item.severity === "critical") ? "critical" : "neutral"
              }
              action={
                <DashboardLink to="/supplier/orders" search={{ filter: "action" }}>
                  View orders
                </DashboardLink>
              }
            >
              {priorities.length ? (
                <ActionQueue label="Seller priorities" items={priorities} />
              ) : (
                <SectionEmpty
                  icon={Check}
                  title="You are all caught up"
                  copy="There are no fulfillment, cancellation, or stock issues waiting for you."
                />
              )}
            </DashboardCard>

            <MetricCard
              icon={Wallet}
              label="Available payout"
              value={formatPrice(dashboard.earnings.available)}
              period="Net of commission"
              context={`${formatPrice(dashboard.earnings.paid)} paid to date · ${formatPrice(dashboard.earnings.commission)} commission withheld`}
              hint="SoukCart collects payment (including COD), takes commission, and pays you weekly."
              to="/supplier/earnings"
              linkLabel="Open earnings"
            />
          </DashboardRow>

          <DashboardRow split="8-4">
            <TrendChartCard
              eyebrow="Performance"
              title="Gross sales and order flow"
              rangeLabel={seriesRange(dashboard.series)}
              labels={dashboard.series.map((bucket) => bucket.label)}
              series={[
                {
                  key: "sales",
                  label: "Gross sales",
                  values: dashboard.series.map((bucket) => bucket.value),
                  format: formatPrice,
                  kind: "area",
                },
                {
                  key: "orders",
                  label: "Orders",
                  values: dashboard.series.map((bucket) => bucket.count),
                  format: (value) => `${value}`,
                  kind: "line",
                },
              ]}
              summary={`${formatPrice(summary.sales)} in gross sales from ${summary.orders} orders during the last ${dashboard.windowDays} days. ${summary.salesDelta.label}.`}
              action={
                <DashboardLink to="/supplier/orders" search={{ filter: "all" }}>
                  All orders
                </DashboardLink>
              }
              emptyCopy="No paid orders included your products in this period."
            />

            <DashboardCard
              eyebrow="Inventory"
              title="Stock health"
              meta="Active listings only"
              severity={summary.outOfStock ? "critical" : "neutral"}
              action={<DashboardLink to="/supplier/stock">Inventory</DashboardLink>}
            >
              <HealthWidget
                label="Stock health"
                total={summary.activeListings}
                totalLabel="active products"
                segments={dashboard.stockHealth.segments}
                items={stockHealthItems(dashboard)}
                emptyCopy="Every active product has healthy stock."
              />
            </DashboardCard>
          </DashboardRow>

          <DashboardRow split="full">
            <DashboardCard
              eyebrow="Fulfillment"
              title="Orders waiting for you"
              meta="Confirm, ship, or resolve cancellations — COD is handled by SoukCart"
              severity={dashboard.queue.length ? "attention" : "neutral"}
              action={
                <DashboardLink to="/supplier/orders" search={{ filter: "action" }}>
                  Open work queue
                </DashboardLink>
              }
            >
              {dashboard.queue.length ? (
                <DashboardTable
                  label="Orders awaiting your action"
                  columns={queueColumns}
                  rows={dashboard.queue}
                  rowKey={(order) => order.id}
                />
              ) : (
                <SectionEmpty
                  icon={Check}
                  title="Nothing waiting on you"
                  copy="Every current order has completed its required seller step."
                />
              )}
            </DashboardCard>
          </DashboardRow>
        </>
      ) : (
        <DashboardSkeleton label="Loading your seller dashboard…" />
      )}
    </SupplierWorkspaceShell>
  );
}
