import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, MessageSquare, RefreshCw, ShieldCheck, Users, Wallet } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  DashboardLink,
  DashboardRow,
  DashboardSkeleton,
  MetricCard,
  MetricRow,
} from "../../components/dashboard/Dashboard.tsx";
import { TrendChartCard } from "../../components/dashboard/DashboardCharts.tsx";
import {
  type DashboardBucket,
  type DashboardSeverity,
} from "../../components/dashboard/dashboard-model.ts";
import { PageHeader, WorkspaceError } from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatPrice, formatUpdatedAt } from "../workspace/format.ts";
import { useTableChanges } from "../../workspace-realtime.ts";
import { loadAdminDashboard, type AdminDashboard } from "./admin-dashboard-api.ts";
import { AdminWorkspaceShell } from "./admin-workspace-shell.tsx";

type AdminOverviewProps = {
  loadDashboard?: () => Promise<AdminDashboard>;
};

type Freshness = "current" | "refreshing" | "stale";

const ADMIN_LIVE_TABLES = ["orders", "complaints", "supplier_profiles"] as const;

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

export function AdminOverview({ loadDashboard = loadAdminDashboard }: AdminOverviewProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [freshness, setFreshness] = useState<Freshness>("refreshing");
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const dashboardRef = useRef<AdminDashboard | null>(null);
  dashboardRef.current = dashboard;

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let current = true;
    const hasData = dashboardRef.current !== null;
    setLoading(true);
    if (hasData) {
      setFreshness("refreshing");
    } else {
      setError(null);
    }

    void loadDashboard()
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
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [loadDashboard, loadVersion]);

  const retry = useCallback(() => setLoadVersion((version) => version + 1), []);

  useTableChanges({
    enabled: Boolean(dashboard) && !error,
    tables: ADMIN_LIVE_TABLES,
    onChange: retry,
  });

  if (state.status !== "admin") return null;

  const onLogout = () => {
    void store.signOut();
  };
  const userName = state.profile.name || "Administrator";

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Admin"
        title="We could not load the admin home."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  return (
    <AdminWorkspaceShell
      activePath="/admin"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Home"
        title="Marketplace at a glance."
        copy="See sales for the last 30 days and jump straight into work that needs you."
        actions={
          <div className="flex flex-wrap items-center gap-2">
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
            <Button type="button" variant="ghost" disabled={loading} onClick={retry}>
              {loading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              Refresh
            </Button>
          </div>
        }
      />
      {freshness === "stale" && refreshError ? (
        <Alert variant="destructive" role="status">
          <AlertTitle>Couldn’t refresh—showing older data</AlertTitle>
          <AlertDescription>{refreshError}</AlertDescription>
        </Alert>
      ) : null}

      {dashboard ? (
        <AdminOverviewBody dashboard={dashboard} />
      ) : (
        <DashboardSkeleton label="Loading the admin home…" />
      )}
    </AdminWorkspaceShell>
  );
}

function AdminOverviewBody({ dashboard }: { dashboard: AdminDashboard }) {
  const summary = dashboard.summary;
  const period = `Last ${dashboard.windowDays} days`;
  const showAccountsMetric = summary.accountsNeedingSetup > 0;

  return (
    <>
      <MetricRow label="Marketplace performance and open work">
        <MetricCard
          icon={Activity}
          label="Order value"
          value={formatPrice(summary.orderValue)}
          period={period}
          delta={summary.orderValueDelta}
          hint="Total of non-cancelled orders in this window. This is not settled revenue."
          context={`Paid ${formatPrice(summary.paidOrderValue)} · ${summary.orders} orders placed`}
          to="/admin/order"
          linkLabel="Open orders"
        />
        <MetricCard
          icon={Wallet}
          label="Collected revenue"
          value={formatPrice(Math.max(summary.collectedRevenue, 0))}
          period={period}
          hint="Payment captured minus refunds paid. A payment joins this when it is captured, and leaves it the moment a refund is paid out."
          context={`${formatPrice(summary.settledRevenue)} settled on delivered orders · ${formatPrice(summary.refundedTotal)} refunded`}
          to="/admin/order"
          linkLabel="Open orders"
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
        {showAccountsMetric ? (
          <MetricCard
            icon={Users}
            label="Accounts needing setup"
            value={summary.accountsNeedingSetup}
            period="Open right now"
            context={`${summary.accounts} accounts · ${summary.newAccounts} joined this week · ${summary.activeAccounts} signed in recently`}
            severity={severityFor(summary.accountsNeedingSetup)}
            to="/admin/users"
            linkLabel="Open users"
          />
        ) : (
          <MetricCard
            icon={ShieldCheck}
            label="Pending verifications"
            value={summary.pendingVerifications}
            period="Open right now"
            hint="Supplier shop applications waiting for a decision."
            context={
              summary.pendingVerifications
                ? "Supplier applications waiting for review"
                : "All supplier applications are decided"
            }
            severity={severityFor(summary.pendingVerifications)}
            to="/admin/verifications"
            linkLabel="Review applications"
          />
        )}
      </MetricRow>

      <DashboardRow split="full">
        <TrendChartCard
          eyebrow="Trend"
          title="Orders per day"
          rangeLabel={seriesRange(dashboard.series)}
          labels={dashboard.series.map((bucket) => bucket.label)}
          series={[
            {
              key: "orders",
              label: "Orders",
              values: dashboard.series.map((bucket) => bucket.count),
              format: (value) => `${value}`,
              kind: "bar",
            },
          ]}
          summary={`${summary.orders} orders placed in the last ${dashboard.windowDays} days.`}
          action={<DashboardLink to="/admin/order">All orders</DashboardLink>}
          emptyCopy="No orders were placed in this window, so there is nothing to chart yet."
        />
      </DashboardRow>
    </>
  );
}
