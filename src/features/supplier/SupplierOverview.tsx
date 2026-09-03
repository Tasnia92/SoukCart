import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DashboardBadge,
  DashboardCard,
  DashboardLink,
  DashboardRow,
  DashboardSkeleton,
  DashboardTable,
  HealthWidget,
  MetricCard,
  MetricRow,
  SectionEmpty,
  type DashboardColumn,
  type HealthItem,
} from "../../components/dashboard/Dashboard.tsx";
import { RankedBarCard, TrendChartCard } from "../../components/dashboard/DashboardCharts.tsx";
import type {
  DashboardBucket,
  DashboardSeverity,
} from "../../components/dashboard/dashboard-model.ts";
import { Icon } from "../../components/ui/Icon.tsx";
import { InlineNotice, PageHeader, WorkspaceError } from "../../components/ui/Workspace.tsx";
import { useProductChanges } from "../../product-realtime.ts";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { PaymentBadge, shortId, StatusBadge } from "../orders/order-presentation.tsx";
import { firstName, formatDate, formatPrice } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  loadSupplierDashboard,
  LOW_STOCK_THRESHOLD,
  type SupplierDashboard,
  type SupplierQueueOrder,
} from "./supplier-dashboard-api.ts";
import { consumeSupplierNotice, ProductThumb, supplierNavItems } from "./supplier-shared.tsx";

type SupplierOverviewProps = {
  loadDashboard?: (sellerId: string) => Promise<SupplierDashboard>;
};

/** Stock and product edits can fire several row events; batch them into one reload. */
const REALTIME_COALESCE_MS = 400;

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
    cell: (order) => <span className="db-cell-strong">#{shortId(order.id)}</span>,
  },
  {
    key: "retailer",
    header: "Retailer",
    cell: (order) => (
      <span className="db-cell-stack">
        <span className="db-cell-strong">{order.retailerName}</span>
        <small>{order.retailerEmail}</small>
      </span>
    ),
  },
  { key: "units", header: "Units", numeric: true, cell: (order) => order.units },
  {
    key: "value",
    header: "Your value",
    numeric: true,
    cell: (order) => <span className="db-cell-strong">{formatPrice(order.total)}</span>,
  },
  {
    key: "status",
    header: "Status",
    cell: (order) => (
      <>
        <StatusBadge status={order.status} />
        {order.cancelRequested ? (
          <DashboardBadge severity="critical">Cancel requested</DashboardBadge>
        ) : null}
        <PaymentBadge paymentStatus={order.paymentStatus} paymentMethod={order.paymentMethod} />
      </>
    ),
  },
  {
    key: "age",
    header: "Waiting",
    cell: (order) => (
      <span className={order.ageDays >= 1 ? "db-cell-strong" : undefined}>
        {ageLabel(order.ageDays)}
      </span>
    ),
  },
  {
    key: "action",
    header: "Action",
    cell: (order) => (
      <RouterLink className="db-queue-action" to="/supplier/orders">
        <span>{order.cancelRequested ? "Review" : "Process order"}</span>
        <Icon name="arrow-right" />
      </RouterLink>
    ),
  },
];

function stockHealthItems(dashboard: SupplierDashboard): HealthItem[] {
  return dashboard.stockRisk.map((product) => ({
    id: product.id,
    title: product.name,
    detail: product.stock <= 0 ? "Out of stock — hidden from retailers" : `Low on ${product.unit}s`,
    marker: product.stock <= 0 ? "0 left" : `${product.stock} left`,
    severity: product.severity,
    to: "/supplier/stock",
    actionLabel: "Restock",
  }));
}

export function SupplierOverview({ loadDashboard = loadSupplierDashboard }: SupplierOverviewProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier" });
  const [dashboard, setDashboard] = useState<SupplierDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice] = useState(consumeSupplierNotice);

  const sellerId = state.status === "seller" ? state.session.user.id : "";
  const invalidate = useCallback(() => setLoadVersion((version) => version + 1), []);

  useProductChanges({
    enabled: Boolean(sellerId),
    sellerId,
    onChange: invalidate,
    coalesceMs: REALTIME_COALESCE_MS,
  });

  useEffect(() => {
    if (!sellerId) return;
    let current = true;
    setError(null);

    void loadDashboard(sellerId)
      .then((next) => {
        // Keep the previous dashboard on screen until the new one is ready.
        if (current) setDashboard(next);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
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
        eyebrow="Supplier workspace"
        title="We could not load your workspace."
        message={error}
        onRetry={invalidate}
        onLogout={onLogout}
      />
    );
  }

  const summary = dashboard?.summary;
  const period = `Last ${dashboard?.windowDays ?? 30} days`;

  return (
    <WorkspaceShell
      navigationLabel="Supplier navigation"
      items={supplierNavItems("overview")}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        title={<>Good to see you, {firstName(userName)}.</>}
        copy="Accept what is waiting, restock what is running out, and see which products are carrying your sales."
        actions={
          <>
            <Button asChild>
              <RouterLink to="/supplier/orders">
                <Icon name="package" />
                Process orders
              </RouterLink>
            </Button>
            <Button asChild variant="outline">
              <RouterLink to="/supplier/products/new">
                <Icon name="plus" />
                Add product
              </RouterLink>
            </Button>
          </>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />

      {dashboard && summary ? (
        <>
          <MetricRow label="Sales, fulfillment and inventory health">
            <MetricCard
              icon="activity"
              label="Sales"
              value={formatPrice(summary.sales)}
              period={period}
              delta={summary.salesDelta}
              context={`${summary.orders} orders included your products`}
              to="/supplier/orders"
              linkLabel="Open orders"
            />
            <MetricCard
              icon="clock"
              label="Awaiting fulfillment"
              value={summary.awaitingFulfillment}
              period="Open right now"
              context={
                summary.cancellationRequests
                  ? `${summary.cancellationRequests} cancellation request${summary.cancellationRequests === 1 ? "" : "s"} also need a decision`
                  : "Orders you have not accepted yet"
              }
              severity={severityFor(summary.awaitingFulfillment, summary.cancellationRequests > 0)}
              to="/supplier/orders"
              linkLabel="Accept orders"
            />
            <MetricCard
              icon="layers"
              label="Stock at risk"
              value={summary.stockAtRisk}
              period="Active listings"
              context={`${summary.outOfStock} out of stock · ${summary.lowStock} at or below ${LOW_STOCK_THRESHOLD} units`}
              severity={severityFor(summary.stockAtRisk, summary.outOfStock > 0)}
              to="/supplier/stock"
              linkLabel="Manage stock"
            />
            <MetricCard
              icon="bag"
              label="Active listings"
              value={summary.activeListings}
              period="Visible to retailers"
              context={`${summary.totalListings} products in your catalog`}
              to="/supplier/products"
              linkLabel="Open catalog"
            />
          </MetricRow>

          <DashboardRow split="8-4">
            <TrendChartCard
              eyebrow="Trend"
              title="Sales and order flow"
              rangeLabel={seriesRange(dashboard.series)}
              labels={dashboard.series.map((bucket) => bucket.label)}
              series={[
                {
                  key: "sales",
                  label: "Your earnings",
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
              summary={`${formatPrice(summary.sales)} earned from ${summary.orders} orders in the last ${dashboard.windowDays} days. ${summary.salesDelta.label}.`}
              action={<DashboardLink to="/supplier/orders">All orders</DashboardLink>}
              emptyCopy="No orders included your products in this window."
            />

            <DashboardCard
              eyebrow="Inventory"
              title="Stock health"
              meta="Active listings only"
              severity={summary.outOfStock ? "critical" : "neutral"}
              action={<DashboardLink to="/supplier/stock">Stock</DashboardLink>}
            >
              <HealthWidget
                label="Stock health"
                total={summary.activeListings}
                totalLabel="active listings"
                segments={dashboard.stockHealth.segments}
                items={stockHealthItems(dashboard)}
                emptyCopy="Every active listing has healthy stock."
              />
            </DashboardCard>
          </DashboardRow>

          <DashboardRow split="full">
            <DashboardCard
              eyebrow="Needs action"
              title="Fulfillment queue"
              meta="Orders you can accept or resolve now"
              severity={dashboard.queue.length ? "critical" : "neutral"}
              action={<DashboardLink to="/supplier/orders">Open orders</DashboardLink>}
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
                  icon="check"
                  title="Nothing waiting on you"
                  copy="Every incoming order has been accepted. New ones will land here."
                />
              )}
            </DashboardCard>
          </DashboardRow>

          <DashboardRow split="8-4">
            <RankedBarCard
              eyebrow="Insight"
              title="Top products"
              rangeLabel={`${period} · by value sold`}
              items={dashboard.topProducts.map((product) => ({
                id: product.id,
                label: product.name,
                value: product.value,
                meta: `${product.units} units sold`,
              }))}
              format={formatPrice}
              valueLabel="value sold"
              action={<DashboardLink to="/supplier/products">Catalog</DashboardLink>}
              emptyCopy="Once orders come through, your best sellers will rank here."
            />

            <DashboardCard
              eyebrow="Catalog"
              title="Recent listings"
              meta={`Newest ${dashboard.recentListings.length}`}
              action={<DashboardLink to="/supplier/products">All products</DashboardLink>}
            >
              {dashboard.recentListings.length ? (
                <ul className="db-listings">
                  {dashboard.recentListings.map((product) => (
                    <li className="db-listing" key={product.id}>
                      <span className="db-listing-art">
                        <ProductThumb product={product} />
                      </span>
                      <span className="db-listing-body">
                        <strong>{product.name}</strong>
                        <small>
                          {formatPrice(product.price)} per {product.unit} ·{" "}
                          {formatDate(product.created_at)}
                        </small>
                      </span>
                      <span className="db-listing-end">
                        <RouterLink
                          className="db-queue-action"
                          to="/supplier/products/$productId/edit"
                          params={{ productId: product.id }}
                        >
                          <span>{product.stock} in stock</span>
                          <Icon name="arrow-right" />
                        </RouterLink>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <SectionEmpty
                  icon="store"
                  title="No products yet"
                  copy="Add your first product and retailers will see it in the catalog."
                  action={
                    <Button asChild>
                      <RouterLink to="/supplier/products/new">
                        <span>Add product</span>
                      </RouterLink>
                    </Button>
                  }
                />
              )}
            </DashboardCard>
          </DashboardRow>
        </>
      ) : (
        <DashboardSkeleton label="Loading your workspace…" />
      )}
    </WorkspaceShell>
  );
}
