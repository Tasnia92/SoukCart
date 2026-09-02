import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  DashboardBadge,
  DashboardCard,
  DashboardLink,
  DashboardRow,
  DashboardSkeleton,
  DashboardTable,
  MetricCard,
  MetricRow,
  SectionEmpty,
  SectionError,
  type DashboardColumn,
} from "../../components/dashboard/Dashboard.tsx";
import { TrendChartCard } from "../../components/dashboard/DashboardCharts.tsx";
import {
  failureFor,
  type DashboardBucket,
  type DashboardSeverity,
} from "../../components/dashboard/dashboard-model.ts";
import { Icon } from "../../components/ui/Icon.tsx";
import { InlineNotice, PageHeader, WorkspaceError } from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { PaymentBadge, shortId, StatusBadge } from "../orders/order-presentation.tsx";
import { firstName, formatDate, formatPrice } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  buildRetailerDashboard,
  loadRetailerDashboardInput,
  RETAILER_HELP_SECTION,
  type RetailerDashboardInput,
  type RetailerNextAction,
  type RetailerRecentOrder,
} from "./retailer-dashboard-api.ts";
import { consumeRetailerNotice } from "./retailer-flash.ts";
import type { RetailerOrder } from "./retailer-orders-api.ts";
import { applyReconciliation, reconcileRetailerPayments } from "./retailer-overview-api.ts";

type LoadedInput = RetailerDashboardInput & { orders: RetailerOrder[] };

type RetailerOverviewProps = {
  loadInput?: (retailerId: string) => Promise<LoadedInput>;
  /** Overridable so tests can render without touching the payment gateway. */
  reconcile?: (
    retailerId: string,
    orders: readonly RetailerOrder[],
  ) => Promise<{
    updates: { id: string; payment_status: RetailerOrder["payment_status"] }[];
    cartCleared: boolean;
  }>;
};

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

const recentColumns: DashboardColumn<RetailerRecentOrder>[] = [
  {
    key: "order",
    header: "Order",
    cell: (order) => <span className="db-cell-strong">#{shortId(order.id)}</span>,
  },
  { key: "placed", header: "Placed", cell: (order) => formatDate(order.createdAt) },
  { key: "units", header: "Units", numeric: true, cell: (order) => order.units },
  {
    key: "total",
    header: "Total",
    numeric: true,
    cell: (order) => <span className="db-cell-strong">{formatPrice(order.total)}</span>,
  },
  {
    key: "payment",
    header: "Payment",
    cell: (order) => (
      <PaymentBadge
        paymentStatus={order.paymentStatus}
        paymentMethod={order.paymentMethod}
        showFailed
      />
    ),
  },
  {
    key: "status",
    header: "Fulfillment",
    cell: (order) => (
      <>
        <StatusBadge status={order.status} />
        {order.cancelRequested ? (
          <DashboardBadge severity="attention">Cancellation requested</DashboardBadge>
        ) : null}
      </>
    ),
  },
  {
    key: "action",
    header: "Action",
    cell: (order) => (
      <RouterLink className="db-queue-action" to="/retailer/orders">
        <span>{order.needsDeliveryConfirmation ? "Confirm delivery" : "View order"}</span>
        <Icon name="arrow-right" />
      </RouterLink>
    ),
  },
];

/** The single most useful move, stated before any number on the page. */
function NextActionWidget({ action }: { action: RetailerNextAction }) {
  return (
    <section
      className={`db-next is-${action.severity}`}
      aria-label="Your next step"
      aria-live="polite"
    >
      <span className="db-next-icon">
        <Icon name={action.icon} />
      </span>
      <div className="db-next-body">
        <p className="eyebrow">{action.eyebrow}</p>
        <strong>{action.title}</strong>
        <p>{action.copy}</p>
      </div>
      <div className="db-next-actions">
        <RouterLink className="button button-primary" to={action.to}>
          <Icon name={action.icon} />
          <span>{action.actionLabel}</span>
        </RouterLink>
      </div>
    </section>
  );
}

export function RetailerOverview({
  loadInput = loadRetailerDashboardInput,
  reconcile = reconcileRetailerPayments,
}: RetailerOverviewProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer" });
  const [input, setInput] = useState<LoadedInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice] = useState(consumeRetailerNotice);

  const retailerId = state.status === "retailer" ? state.session.user.id : "";

  useEffect(() => {
    if (!retailerId) return;
    let current = true;
    setError(null);

    void loadInput(retailerId)
      .then((next) => {
        if (!current) return;
        setInput(next);

        // Payment reconciliation runs after the dashboard has painted, so a slow
        // gateway can no longer hold up the whole page.
        void reconcile(retailerId, next.orders)
          .then(({ updates, cartCleared }) => {
            if (!current || (!updates.length && !cartCleared)) return;
            setInput((previous) =>
              previous
                ? {
                    ...previous,
                    orders: applyReconciliation(previous.orders, updates),
                    cartUnits: cartCleared ? 0 : previous.cartUnits,
                  }
                : previous,
            );
          })
          .catch(() => {
            // Reconciliation is a background correction; the shown data stays valid.
          });
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadInput, loadVersion, reconcile, retailerId]);

  const dashboard = useMemo(() => (input ? buildRetailerDashboard(input) : null), [input]);

  if (state.status !== "retailer") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || state.profile.email;

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Retailer workspace"
        title="We could not load your workspace."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const summary = dashboard?.summary;
  const period = `Last ${dashboard?.windowDays ?? 30} days`;
  const cartUnits = dashboard?.summary.cartUnits ?? 0;
  const helpFailure = dashboard ? failureFor(dashboard.failures, RETAILER_HELP_SECTION) : null;

  return (
    <WorkspaceShell
      navigationLabel="Retailer navigation"
      items={[
        { to: "/retailer", icon: "home", label: "Overview", active: true },
        { to: "/retailer/catalog", icon: "bag", label: "Place order" },
        {
          to: "/retailer/cart",
          icon: "cart",
          label: "Cart",
          trailing: cartUnits ? <span className="rt-nav-badge">{cartUnits}</span> : undefined,
        },
        { to: "/retailer/orders", icon: "package", label: "My orders" },
        { to: "/retailer/complaints", icon: "message", label: "Help Center" },
      ]}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Ordering & delivery"
        title={`Good to see you, ${firstName(userName)}.`}
        copy="One next step, then everything you have in flight and what you have spent."
        actions={
          <>
            <RouterLink className="button button-primary" to="/retailer/catalog">
              <Icon name="bag" />
              <span>Place order</span>
            </RouterLink>
            <RouterLink className="button button-subtle" to="/retailer/orders">
              <Icon name="package" />
              <span>My orders</span>
            </RouterLink>
          </>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />

      {dashboard && summary ? (
        <>
          <NextActionWidget action={dashboard.nextAction} />

          <MetricRow label="Spend and delivery status">
            <MetricCard
              icon="activity"
              label="Spend"
              value={formatPrice(summary.spend)}
              period={period}
              delta={summary.spendDelta}
              context={`${summary.orders} orders placed in this period`}
              to="/retailer/orders"
              linkLabel="Open my orders"
            />
            <MetricCard
              icon="truck"
              label="Active orders"
              value={summary.activeOrders}
              period="In flight right now"
              context="Placed, confirmed or on the way"
              severity={severityFor(summary.activeOrders)}
              to="/retailer/orders"
              linkLabel="Track deliveries"
            />
            <MetricCard
              icon="check"
              label="Delivered"
              value={summary.delivered}
              period={period}
              context="Completed in this period"
              severity={summary.delivered ? "positive" : "neutral"}
              to="/retailer/orders"
              linkLabel="See delivered orders"
            />
            <MetricCard
              icon="cart"
              label="In your cart"
              value={summary.cartUnits}
              period="Not ordered yet"
              context={summary.cartUnits ? "Waiting on checkout" : "Your cart is empty right now"}
              severity={severityFor(summary.cartUnits)}
              to="/retailer/cart"
              linkLabel="Open cart"
            />
          </MetricRow>

          <DashboardRow split="7-5">
            <DashboardCard
              eyebrow="Fulfillment"
              title="Where your orders stand"
              meta="Every order you have placed"
              action={<DashboardLink to="/retailer/orders">My orders</DashboardLink>}
            >
              <ul className="db-stages">
                {dashboard.stages.map((stage) => (
                  <li
                    className={`db-stage${stage.count ? ` is-${stage.severity}` : ""}`}
                    key={stage.key}
                  >
                    <span className="db-stage-count">{stage.count}</span>
                    <span className="db-stage-label">{stage.label}</span>
                  </li>
                ))}
              </ul>
              <p className="db-note db-stages-note">
                {summary.activeOrders
                  ? `${summary.activeOrders} order${summary.activeOrders === 1 ? "" : "s"} still moving. Confirm each delivery when it arrives to close it out.`
                  : "Nothing is in transit. Your next order will show its progress here."}
              </p>
            </DashboardCard>

            <TrendChartCard
              eyebrow="Trend"
              title="Weekly spend"
              rangeLabel={seriesRange(dashboard.series)}
              labels={dashboard.series.map((bucket) => bucket.label)}
              series={[
                {
                  key: "spend",
                  label: "Spend",
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
              summary={`${formatPrice(summary.spend)} across ${summary.orders} orders in the last ${dashboard.windowDays} days. ${summary.spendDelta.label}.`}
              emptyCopy="You have not placed an order in this window yet."
            />
          </DashboardRow>

          <DashboardRow split="8-4">
            <DashboardCard
              eyebrow="Latest activity"
              title="Recent orders"
              meta={`Newest ${dashboard.recent.length}`}
              action={<DashboardLink to="/retailer/orders">View all</DashboardLink>}
            >
              {dashboard.recent.length ? (
                <DashboardTable
                  label="Your most recent orders"
                  columns={recentColumns}
                  rows={dashboard.recent}
                  rowKey={(order) => order.id}
                />
              ) : (
                <SectionEmpty
                  icon="store"
                  title="No orders yet"
                  copy="Start with the catalog and place your first order."
                  action={
                    <RouterLink className="button button-primary" to="/retailer/catalog">
                      <span>Place order</span>
                    </RouterLink>
                  }
                />
              )}
            </DashboardCard>

            <DashboardCard
              eyebrow="Support"
              title="Help Center tickets"
              meta="Complaints you have filed"
              severity={dashboard.help.open ? "attention" : "neutral"}
              action={<DashboardLink to="/retailer/complaints">Help Center</DashboardLink>}
            >
              {helpFailure ? (
                <SectionError message={helpFailure.message} onRetry={retry} />
              ) : (
                <>
                  <ul className="db-figures">
                    <li>
                      <strong>{dashboard.help.open}</strong>
                      <span>Open</span>
                    </li>
                    <li>
                      <strong>{dashboard.help.resolved}</strong>
                      <span>Resolved</span>
                    </li>
                  </ul>
                  <p className="db-note">
                    {dashboard.help.total
                      ? "Our team replies inside the Help Center. File a new ticket there if something is wrong with an order."
                      : "Nothing filed yet. Open a ticket from the Help Center if an order needs attention."}
                  </p>
                </>
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
