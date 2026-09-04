import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Check,
  CircleAlert,
  Clock,
  Layers,
  Package,
  Plus,
  RefreshCw,
  Store,
  Truck,
  Wallet,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ActionQueue,
  DashboardCard,
  DashboardLink,
  DashboardRow,
  DashboardSkeleton,
  DashboardTable,
  HealthWidget,
  MetricCard,
  MetricRow,
  SectionEmpty,
  type ActionQueueEntry,
  type DashboardColumn,
  type HealthItem,
} from "../../components/dashboard/Dashboard.tsx";
import { RankedBarCard, TrendChartCard } from "../../components/dashboard/DashboardCharts.tsx";
import type {
  DashboardBucket,
  DashboardSeverity,
} from "../../components/dashboard/dashboard-model.ts";
import { InlineNotice, PageHeader, WorkspaceError } from "../../components/ui/Workspace.tsx";
import { useProductChanges } from "../../product-realtime.ts";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { useTableChanges } from "../../workspace-realtime.ts";
import { PaymentBadge, shortId, StatusBadge } from "../orders/order-presentation.tsx";
import { firstName, formatDate, formatPrice, formatUpdatedAt } from "../workspace/format.ts";
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import {
  loadSupplierDashboard,
  LOW_STOCK_THRESHOLD,
  SUPPLIER_WINDOW_OPTIONS,
  type SupplierDashboard,
  type SupplierQueueOrder,
  type SupplierWindowDays,
} from "./supplier-dashboard-api.ts";
import { consumeSupplierNotice, ProductThumb, SupplierWorkspaceShell } from "./supplier-shared.tsx";

type SupplierOverviewProps = {
  loadDashboard?: (sellerId: string, windowDays: number) => Promise<SupplierDashboard>;
};

type Freshness = "current" | "refreshing" | "stale";

/** Stock and product edits can fire several row events; batch them into one reload. */
const REALTIME_COALESCE_MS = 400;
const ORDER_LIVE_TABLES = ["orders", "seller_payouts"] as const;

function seriesRange(series: readonly DashboardBucket[]): string {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return "No period";
  return `${first.label} – ${last.label} · daily`;
}

function severityFor(count: number, escalated = false): DashboardSeverity {
  if (count === 0) return "neutral";
  return escalated ? "critical" : "attention";
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
      title: `${summary.toShip} order${summary.toShip === 1 ? "" : "s"} to ship`,
      detail: "Confirmed orders ready for dispatch.",
      severity: "attention",
      marker: "To ship",
      to: "/supplier/orders",
      search: { filter: "to-ship" },
      actionLabel: "Ship",
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

export function SupplierOverview({
  loadDashboard = (sellerId, windowDays) =>
    loadSupplierDashboard(sellerId, undefined, Date.now(), windowDays),
}: SupplierOverviewProps) {
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
  const [windowDays, setWindowDays] = useState<SupplierWindowDays>(30);
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

    void loadDashboard(sellerId, windowDays)
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
  }, [loadDashboard, loadVersion, sellerId, windowDays]);

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
  const period = `Last ${dashboard?.windowDays ?? windowDays} days`;
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
            <ToggleGroup
              type="single"
              value={String(windowDays)}
              onValueChange={(value) => {
                if (!value) return;
                const next = Number(value) as SupplierWindowDays;
                if ((SUPPLIER_WINDOW_OPTIONS as readonly number[]).includes(next)) {
                  setWindowDays(next);
                }
              }}
              variant="outline"
              size="sm"
              aria-label="Reporting window"
            >
              {SUPPLIER_WINDOW_OPTIONS.map((days) => (
                <ToggleGroupItem key={days} value={String(days)}>
                  {days}d
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {updatedAt ? (
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {freshness === "refreshing"
                  ? "Refreshing"
                  : freshness === "stale"
                    ? "Couldn’t refresh—showing older data"
                    : formatUpdatedAt(updatedAt, nowTick)}
              </span>
            ) : null}
            {freshness === "current" ? <Badge variant="secondary">Up to date</Badge> : null}
            {freshness === "refreshing" ? <Badge variant="outline">Refreshing</Badge> : null}
            <Button
              type="button"
              variant="ghost"
              disabled={loading && !dashboard}
              onClick={invalidate}
            >
              {loading && dashboard ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              Refresh
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
              hint="Payouts become available after an order is delivered and paid."
              to="/supplier/earnings"
              linkLabel="Open earnings"
            />
          </DashboardRow>

          <MetricRow label="Store performance and inventory health">
            <MetricCard
              icon={Activity}
              label="Gross sales"
              value={formatPrice(summary.sales)}
              period={period}
              delta={summary.salesDelta}
              context={`${summary.orders} paid order${summary.orders === 1 ? "" : "s"} included your products`}
              to="/supplier/orders"
              search={{ filter: "all" }}
              linkLabel="View sales orders"
            />
            <MetricCard
              icon={Wallet}
              label="Net earnings"
              value={formatPrice(summary.netEarnings)}
              period="Available + paid"
              context={`${formatPrice(dashboard.earnings.commission)} commission withheld`}
              to="/supplier/earnings"
              linkLabel="Open earnings ledger"
            />
            <MetricCard
              icon={Package}
              label="Orders completed"
              value={summary.ordersCompleted}
              period={period}
              context="Delivered orders in this window"
              to="/supplier/orders"
              search={{ filter: "delivered" }}
              linkLabel="Open delivered"
            />
            <MetricCard
              icon={Layers}
              label="Stock at risk"
              value={summary.stockAtRisk}
              period="Active listings"
              context={`${summary.outOfStock} out of stock · ${summary.lowStock} at or below ${LOW_STOCK_THRESHOLD} units`}
              severity={severityFor(summary.stockAtRisk, summary.outOfStock > 0)}
              to="/supplier/stock"
              linkLabel="Manage inventory"
            />
          </MetricRow>

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
              meta="Confirm, ship, collect COD, or resolve cancellations"
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

          <DashboardRow split="8-4">
            <RankedBarCard
              eyebrow="Product performance"
              title="Top products"
              rangeLabel={`${period} · by gross sales`}
              items={dashboard.topProducts.map((product) => ({
                id: product.id,
                label: product.name,
                value: product.value,
                meta: `${product.units} units sold`,
              }))}
              format={formatPrice}
              valueLabel="gross sales"
              action={<DashboardLink to="/supplier/products">View products</DashboardLink>}
              emptyCopy="Once orders come through, your best sellers will rank here."
            />

            <DashboardCard
              eyebrow="Catalog"
              title="Recent products"
              meta={`${dashboard.recentListings.length} newest listings`}
              action={<DashboardLink to="/supplier/products">All products</DashboardLink>}
            >
              {dashboard.recentListings.length ? (
                <ul className="flex flex-col divide-y">
                  {dashboard.recentListings.map((product) => (
                    <li
                      className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                      key={product.id}
                    >
                      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
                        <ProductThumb product={product} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <strong className="truncate">{product.name}</strong>
                        <span className="truncate text-xs text-muted-foreground">
                          {formatPrice(product.price)} per {product.unit} ·{" "}
                          {formatDate(product.created_at)}
                        </span>
                      </span>
                      <RouterLink
                        className="inline-flex shrink-0 items-center gap-1 text-sm font-medium"
                        to="/supplier/products/$productId/edit"
                        params={{ productId: product.id }}
                      >
                        <span>{product.stock} left</span>
                        <ArrowRight aria-hidden="true" />
                      </RouterLink>
                    </li>
                  ))}
                </ul>
              ) : (
                <SectionEmpty
                  icon={Store}
                  title="No products yet"
                  copy="Add your first product and retailers will see it in the catalog."
                  action={
                    <Button asChild>
                      <RouterLink to="/supplier/products/new">Add product</RouterLink>
                    </Button>
                  }
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
