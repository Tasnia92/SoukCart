import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Check,
  House,
  MessageSquare,
  Package,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

function severityVariant(
  severity: DashboardSeverity,
): "default" | "secondary" | "destructive" | "outline" {
  if (severity === "critical") return "destructive";
  if (severity === "attention") return "secondary";
  if (severity === "positive") return "default";
  return "outline";
}

const recentColumns: DashboardColumn<RetailerRecentOrder>[] = [
  {
    key: "order",
    header: "Order",
    cell: (order) => <span className="font-medium">#{shortId(order.id)}</span>,
  },
  { key: "placed", header: "Placed", cell: (order) => formatDate(order.createdAt) },
  { key: "units", header: "Units", numeric: true, cell: (order) => order.units },
  {
    key: "total",
    header: "Total",
    numeric: true,
    cell: (order) => <span className="font-medium">{formatPrice(order.total)}</span>,
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
      <div className="flex flex-wrap gap-2">
        <StatusBadge status={order.status} />
        {order.cancelRequested ? (
          <DashboardBadge severity="attention">Cancellation requested</DashboardBadge>
        ) : null}
      </div>
    ),
  },
  {
    key: "action",
    header: "Action",
    cell: (order) => (
      <Button asChild variant="link" size="sm" className="h-auto p-0">
        <RouterLink to="/retailer/orders">
          {order.needsDeliveryConfirmation ? "Confirm delivery" : "View order"}
          <ArrowRight data-icon="inline-end" />
        </RouterLink>
      </Button>
    ),
  },
];

/** The single most useful move, stated before any number on the page. */
function NextActionWidget({ action }: { action: RetailerNextAction }) {
  const ActionIcon = action.icon;

  return (
    <Card className="db-next" aria-label="Your next step" aria-live="polite">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ActionIcon className="size-5" aria-hidden="true" />
          {action.title}
        </CardTitle>
        <CardDescription>{action.copy}</CardDescription>
        <CardAction>
          <Badge variant={severityVariant(action.severity)}>{action.eyebrow}</Badge>
        </CardAction>
      </CardHeader>
      <CardFooter className="justify-end">
        <Button asChild>
          <RouterLink to={action.to}>
            <ActionIcon data-icon="inline-start" />
            {action.actionLabel}
          </RouterLink>
        </Button>
      </CardFooter>
    </Card>
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
        { to: "/retailer", icon: House, label: "Overview", active: true },
        { to: "/retailer/catalog", icon: ShoppingBag, label: "Place order" },
        {
          to: "/retailer/cart",
          icon: ShoppingCart,
          label: "Cart",
          trailing: cartUnits || undefined,
        },
        { to: "/retailer/orders", icon: Package, label: "My orders" },
        { to: "/retailer/complaints", icon: MessageSquare, label: "Help Center" },
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
            <Button asChild>
              <RouterLink to="/retailer/catalog">
                <ShoppingBag data-icon="inline-start" />
                Place order
              </RouterLink>
            </Button>
            <Button asChild variant="ghost">
              <RouterLink to="/retailer/orders">
                <Package data-icon="inline-start" />
                My orders
              </RouterLink>
            </Button>
          </>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />

      {dashboard && summary ? (
        <>
          <NextActionWidget action={dashboard.nextAction} />

          <MetricRow label="Spend and delivery status">
            <MetricCard
              icon={Activity}
              label="Spend"
              value={formatPrice(summary.spend)}
              period={period}
              delta={summary.spendDelta}
              context={`${summary.orders} orders placed in this period`}
              to="/retailer/orders"
              linkLabel="Open my orders"
            />
            <MetricCard
              icon={Truck}
              label="Active orders"
              value={summary.activeOrders}
              period="In flight right now"
              context="Placed, confirmed or on the way"
              severity={severityFor(summary.activeOrders)}
              to="/retailer/orders"
              linkLabel="Track deliveries"
            />
            <MetricCard
              icon={Check}
              label="Delivered"
              value={summary.delivered}
              period={period}
              context="Completed in this period"
              severity={summary.delivered ? "positive" : "neutral"}
              to="/retailer/orders"
              linkLabel="See delivered orders"
            />
            <MetricCard
              icon={ShoppingCart}
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
              <div className="db-stages grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {dashboard.stages.map((stage) => (
                  <Card size="sm" key={stage.key}>
                    <CardHeader>
                      <CardTitle className="text-2xl tabular-nums">{stage.count}</CardTitle>
                      <CardDescription>{stage.label}</CardDescription>
                      <CardAction>
                        <Badge variant={severityVariant(stage.count ? stage.severity : "neutral")}>
                          {stage.count ? "Active" : "None"}
                        </Badge>
                      </CardAction>
                    </CardHeader>
                  </Card>
                ))}
              </div>
              <Alert role="note">
                <Truck />
                <AlertTitle>
                  {summary.activeOrders ? "Deliveries in progress" : "No active deliveries"}
                </AlertTitle>
                <AlertDescription>
                  {summary.activeOrders
                    ? `${summary.activeOrders} order${summary.activeOrders === 1 ? "" : "s"} still moving. Confirm each delivery when it arrives to close it out.`
                    : "Nothing is in transit. Your next order will show its progress here."}
                </AlertDescription>
              </Alert>
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
                  icon={Store}
                  title="No orders yet"
                  copy="Start with the catalog and place your first order."
                  action={
                    <Button asChild>
                      <RouterLink to="/retailer/catalog">Place order</RouterLink>
                    </Button>
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
                  <div className="grid grid-cols-2 gap-3">
                    <Card size="sm">
                      <CardHeader>
                        <CardTitle className="text-2xl tabular-nums">
                          {dashboard.help.open}
                        </CardTitle>
                        <CardDescription>Open</CardDescription>
                      </CardHeader>
                    </Card>
                    <Card size="sm">
                      <CardHeader>
                        <CardTitle className="text-2xl tabular-nums">
                          {dashboard.help.resolved}
                        </CardTitle>
                        <CardDescription>Resolved</CardDescription>
                      </CardHeader>
                    </Card>
                  </div>
                  <Alert role="note">
                    <MessageSquare />
                    <AlertTitle>
                      {dashboard.help.total ? "Support history available" : "No tickets filed"}
                    </AlertTitle>
                    <AlertDescription>
                      {dashboard.help.total
                        ? "Our team replies inside the Help Center. File a new ticket there if something is wrong with an order."
                        : "Open a ticket from the Help Center if an order needs attention."}
                    </AlertDescription>
                  </Alert>
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
