import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Clock3,
  Mail,
  MessageSquare,
  Package,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import {
  ActionQueue,
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
import {
  markNotificationRead,
  type OrderNotification,
} from "../notifications/notifications-api.ts";
import { PaymentBadge, shortId, StatusBadge } from "../orders/order-presentation.tsx";
import { formatDate, formatDateTime, formatPrice } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  ADMIN_DISPUTES_SECTION,
  ADMIN_NOTIFICATIONS_SECTION,
  loadAdminDashboard,
  type AdminDashboard,
  type AdminRecentOrder,
} from "./admin-dashboard-api.ts";
import { ADMIN_NAV_ITEMS } from "./admin-nav.ts";

type AdminOverviewProps = {
  loadDashboard?: () => Promise<AdminDashboard>;
};

function seriesRange(series: readonly DashboardBucket[]): string {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return "No period";
  return `${first.label} – ${last.label} · daily`;
}

/** Zero is calm; anything outstanding earns a tone, and money at risk earns the strongest. */
function severityFor(count: number, escalated = false): DashboardSeverity {
  if (count === 0) return "neutral";
  return escalated ? "critical" : "attention";
}

const recentColumns: DashboardColumn<AdminRecentOrder>[] = [
  {
    key: "order",
    header: "Order",
    cell: (order) => <span className="font-medium">#{shortId(order.id)}</span>,
  },
  {
    key: "retailer",
    header: "Retailer",
    cell: (order) => (
      <span className="flex flex-col gap-1">
        <span className="font-medium">{order.retailerName}</span>
        <small className="text-xs text-muted-foreground">{order.retailerEmail}</small>
      </span>
    ),
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
    header: "Status",
    cell: (order) => (
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={order.status} />
        {order.cancelRequested ? (
          <DashboardBadge severity="critical">Cancel requested</DashboardBadge>
        ) : null}
      </div>
    ),
  },
];

function NotificationFeed({
  notifications,
  onMarkRead,
}: {
  notifications: readonly OrderNotification[];
  onMarkRead: (notification: OrderNotification) => void;
}) {
  return (
    <ItemGroup aria-label="System activity notifications">
      {notifications.map((notification) => (
        <Item key={notification.id} variant={notification.read_at ? "default" : "outline"}>
          <ItemContent>
            <ItemTitle>{notification.title}</ItemTitle>
            <ItemDescription>{notification.message}</ItemDescription>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(notification.created_at)}
            </span>
          </ItemContent>
          <ItemActions className="self-start">
            {notification.read_at ? null : (
              <>
                <DashboardBadge severity="attention">New</DashboardBadge>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => onMarkRead(notification)}
                >
                  Mark as read
                </Button>
              </>
            )}
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}

export function AdminOverview({ loadDashboard = loadAdminDashboard }: AdminOverviewProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);

    void loadDashboard()
      .then((next) => {
        if (current) setDashboard(next);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [loadDashboard, loadVersion]);

  if (state.status !== "admin") return null;

  const onLogout = () => {
    void store.signOut();
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || "Administrator";

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Admin workspace"
        title="We could not load the admin workspace."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const onMarkRead = (notification: OrderNotification) => {
    void markNotificationRead(notification.id).then((readAt) => {
      setDashboard((current) =>
        current
          ? {
              ...current,
              notifications: current.notifications.map((item) =>
                item.id === notification.id ? { ...item, read_at: readAt } : item,
              ),
            }
          : current,
      );
    });
  };

  const summary = dashboard?.summary;
  const period = `Last ${dashboard?.windowDays ?? 30} days`;
  const disputesFailure = dashboard ? failureFor(dashboard.failures, ADMIN_DISPUTES_SECTION) : null;
  const feedFailure = dashboard
    ? failureFor(dashboard.failures, ADMIN_NOTIFICATIONS_SECTION)
    : null;
  const unread = dashboard?.notifications.filter((item) => !item.read_at).length ?? 0;

  return (
    <WorkspaceShell
      navigationLabel="Admin navigation"
      items={ADMIN_NAV_ITEMS.map((item) => ({ ...item, active: item.to === "/admin" }))}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Operations"
        title="Command center."
        copy="What moved in the last 30 days, what is blocked right now, and where to act next."
        actions={
          <Button type="button" variant="ghost" disabled={loading} onClick={retry}>
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
        }
      />
      <InlineNotice />

      {dashboard && summary ? (
        <>
          <MetricRow label="Marketplace performance and open work">
            <MetricCard
              icon={Activity}
              label="Revenue"
              value={formatPrice(summary.revenue)}
              period={period}
              delta={summary.revenueDelta}
              context={`${summary.orders} orders placed in this period`}
              to="/admin/activity"
              linkLabel="Open order activity"
            />
            <MetricCard
              icon={Clock3}
              label="Orders awaiting action"
              value={summary.ordersAwaitingAction}
              period="Open right now"
              context={`${summary.pendingOrders} to confirm · ${summary.cancellationRequests} cancellations · ${summary.refundsToComplete} refunds`}
              severity={severityFor(summary.ordersAwaitingAction, summary.refundsToComplete > 0)}
              to="/admin/activity"
              linkLabel="Work the queue"
            />
            <MetricCard
              icon={MessageSquare}
              label="Open disputes"
              value={summary.openDisputes}
              period="Open right now"
              context={`${summary.totalDisputes} filed in total`}
              severity={severityFor(summary.openDisputes)}
              to="/admin/complaints"
              linkLabel="Review disputes"
            />
            <MetricCard
              icon={Users}
              label="Accounts needing setup"
              value={summary.accountsNeedingSetup}
              period="Open right now"
              context={`${summary.accounts} accounts · ${summary.newAccounts} joined this week · ${summary.activeAccounts} signed in recently`}
              severity={severityFor(summary.accountsNeedingSetup)}
              to="/admin/users"
              linkLabel="Open the directory"
            />
          </MetricRow>

          <DashboardRow split="8-4">
            <TrendChartCard
              eyebrow="Trend"
              title="Order volume and revenue"
              rangeLabel={seriesRange(dashboard.series)}
              labels={dashboard.series.map((bucket) => bucket.label)}
              series={[
                {
                  key: "revenue",
                  label: "Revenue",
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
              summary={`${formatPrice(summary.revenue)} across ${summary.orders} orders in the last ${dashboard.windowDays} days. ${summary.revenueDelta.label}.`}
              action={<DashboardLink to="/admin/activity">All orders</DashboardLink>}
              emptyCopy="No orders were placed in this window, so there is no trend to read yet."
            />

            <DashboardCard
              eyebrow="Needs attention"
              title="Urgent queue"
              meta="Refunds, cancellations and disputes"
              severity={dashboard.queue.length ? "critical" : "neutral"}
            >
              {disputesFailure ? (
                <SectionError
                  message={`Disputes could not be loaded, so this queue may be incomplete. ${disputesFailure.message}`}
                  onRetry={retry}
                />
              ) : null}
              {dashboard.queue.length ? (
                <ActionQueue label="Items needing an admin decision" items={dashboard.queue} />
              ) : (
                <SectionEmpty
                  icon={ShieldCheck}
                  title="Nothing is blocked"
                  copy="No refunds, cancellation requests or open disputes are waiting on you."
                />
              )}
            </DashboardCard>
          </DashboardRow>

          <DashboardRow split="8-4">
            <DashboardCard
              eyebrow="Latest activity"
              title="Recent orders"
              meta={`Newest ${dashboard.recent.length} of the marketplace`}
              action={<DashboardLink to="/admin/activity">View all</DashboardLink>}
            >
              {dashboard.recent.length ? (
                <DashboardTable
                  label="Recent marketplace orders"
                  columns={recentColumns}
                  rows={dashboard.recent}
                  rowKey={(order) => order.id}
                />
              ) : (
                <SectionEmpty
                  icon={Package}
                  title="No orders yet"
                  copy="Orders will appear here as soon as retailers start checking out."
                />
              )}
            </DashboardCard>

            <DashboardCard
              eyebrow="Updates"
              title="System activity"
              meta={unread ? `${unread} unread` : "All caught up"}
            >
              {feedFailure ? (
                <SectionError message={feedFailure.message} onRetry={retry} />
              ) : dashboard.notifications.length ? (
                <NotificationFeed notifications={dashboard.notifications} onMarkRead={onMarkRead} />
              ) : (
                <SectionEmpty
                  icon={Mail}
                  title="No notifications"
                  copy="Order and refund events will show up here."
                />
              )}
            </DashboardCard>
          </DashboardRow>

          <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            Need the full ledger?
            <Button asChild variant="link" size="sm">
              <RouterLink to="/admin/activity">
                Open order activity
                <ArrowRight data-icon="inline-end" />
              </RouterLink>
            </Button>
          </p>
        </>
      ) : (
        <DashboardSkeleton label="Loading the admin workspace…" />
      )}
    </WorkspaceShell>
  );
}
