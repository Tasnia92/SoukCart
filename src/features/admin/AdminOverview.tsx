import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Clock3, MessageSquare, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
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
import {
  InlineNotice,
  PageHeader,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatPrice, formatUpdatedAt } from "../workspace/format.ts";
import { WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import { useTableChanges } from "../../workspace-realtime.ts";
import { loadAdminDashboard, type AdminDashboard } from "./admin-dashboard-api.ts";
import { ADMIN_NAV_ITEMS } from "./admin-nav.ts";
import {
  AdminActionWorkspace,
  AdminSlaSummaryCard,
  type QueueKindFilter,
  type QueueSlaFilter,
} from "./admin-overview-panels.tsx";

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
  const [kindFilter, setKindFilter] = useState<QueueKindFilter>("all");
  const [slaFilter, setSlaFilter] = useState<QueueSlaFilter>("all");
  const [notice, setNotice] = useState<{ message: string; state: NoticeState } | null>(null);
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
        eyebrow="Admin workspace"
        title="We could not load the admin workspace."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const summary = dashboard?.summary;
  const period = `Last ${dashboard?.windowDays ?? 30} days`;
  const showAccountsMetric = (summary?.accountsNeedingSetup ?? 0) > 0;

  const applyKindFilter = (value: QueueKindFilter) => {
    setKindFilter(value);
    setSlaFilter("all");
    document.getElementById("admin-action-queue")?.scrollIntoView({ block: "start" });
  };

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
        copy="What is blocked right now, what to do next, and how the marketplace moved in the last 30 days."
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
      {notice ? <InlineNotice message={notice.message} state={notice.state} /> : null}
      {freshness === "stale" && refreshError ? (
        <Alert variant="destructive" role="status">
          <AlertTitle>Couldn’t refresh—showing older data</AlertTitle>
          <AlertDescription>{refreshError}</AlertDescription>
        </Alert>
      ) : null}

      {dashboard && summary ? (
        <>
          {dashboard.queue.length ? (
            <AdminSlaSummaryCard
              dashboard={dashboard}
              slaFilter={slaFilter}
              onSlaFilter={(value) => {
                setSlaFilter(value);
                setKindFilter("all");
              }}
            />
          ) : null}

          <AdminActionWorkspace
            dashboard={dashboard}
            kindFilter={kindFilter}
            slaFilter={slaFilter}
            onKindFilter={setKindFilter}
            onSlaFilter={setSlaFilter}
            onMutated={retry}
            onNotice={setNotice}
            afterQueue={
              <>
                <MetricRow label="Marketplace performance and open work">
                  <MetricCard
                    icon={Activity}
                    label="Order value"
                    value={formatPrice(summary.orderValue)}
                    period={period}
                    delta={summary.orderValueDelta}
                    hint="Gross merchandise value: non-cancelled order totals in this window. This is not settled revenue."
                    context={`Paid ${formatPrice(summary.paidOrderValue)} · ${summary.orders} orders placed in this period`}
                    to="/admin/activity"
                    linkLabel="Open order activity"
                  />
                  <Card
                    size="sm"
                    data-slot="metric-card"
                    className={cn(
                      "db-metric",
                      severityFor(summary.ordersAwaitingAction, summary.refundsToComplete > 0) ===
                        "critical" && "ring-destructive/40",
                      severityFor(summary.ordersAwaitingAction, summary.refundsToComplete > 0) ===
                        "attention" && "ring-primary/30",
                    )}
                  >
                    <CardHeader>
                      <CardDescription className="text-xs font-medium tracking-widest uppercase">
                        <span className="db-metric-label">Orders awaiting action</span>
                      </CardDescription>
                      <CardAction>
                        <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                          <Clock3 />
                        </span>
                      </CardAction>
                      <CardTitle className="db-metric-value text-3xl font-semibold tabular-nums">
                        {summary.ordersAwaitingAction}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2">
                      <p className="text-xs text-muted-foreground">Open right now</p>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        size="sm"
                        orientation="vertical"
                        value={
                          kindFilter === "confirmation" ||
                          kindFilter === "cancellation" ||
                          kindFilter === "refund"
                            ? kindFilter
                            : ""
                        }
                        onValueChange={(value) =>
                          applyKindFilter((value || "all") as QueueKindFilter)
                        }
                        className="w-full"
                        aria-label="Orders awaiting action"
                      >
                        <ToggleGroupItem value="confirmation" className="w-full justify-between">
                          Awaiting confirmation
                          <strong className="tabular-nums">{summary.pendingOrders}</strong>
                        </ToggleGroupItem>
                        <ToggleGroupItem value="cancellation" className="w-full justify-between">
                          Cancellation requests
                          <strong className="tabular-nums">{summary.cancellationRequests}</strong>
                        </ToggleGroupItem>
                        <ToggleGroupItem value="refund" className="w-full justify-between">
                          Refunds due
                          <strong className="tabular-nums">{summary.refundsToComplete}</strong>
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </CardContent>
                  </Card>
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
                      linkLabel="Open the directory"
                    />
                  ) : (
                    <MetricCard
                      icon={ShieldCheck}
                      label="Pending verifications"
                      value={summary.pendingVerifications}
                      period="Open right now"
                      hint="Supplier shop applications waiting for an admin decision."
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
                    title="Order volume and order value"
                    rangeLabel={seriesRange(dashboard.series)}
                    labels={dashboard.series.map((bucket) => bucket.label)}
                    series={[
                      {
                        key: "orderValue",
                        label: "Order value",
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
                    summary={`${formatPrice(summary.orderValue)} GMV across ${summary.orders} orders in the last ${dashboard.windowDays} days. Paid ${formatPrice(summary.paidOrderValue)}. ${summary.orderValueDelta.label}.`}
                    action={<DashboardLink to="/admin/activity">All orders</DashboardLink>}
                    emptyCopy="No orders were placed in this window, so there is no trend to read yet."
                  />
                </DashboardRow>
              </>
            }
          />
        </>
      ) : (
        <DashboardSkeleton label="Loading the admin workspace…" />
      )}
    </WorkspaceShell>
  );
}
