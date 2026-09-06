import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Package, Plus, RefreshCw, Wallet } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  DashboardRow,
  DashboardSkeleton,
  MetricCard,
} from "../../components/dashboard/Dashboard.tsx";
import { InlineNotice, PageHeader, WorkspaceError } from "../../components/ui/Workspace.tsx";
import { useProductChanges } from "../../product-realtime.ts";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { useTableChanges } from "../../workspace-realtime.ts";
import { firstName, formatPrice, formatUpdatedAt } from "../workspace/format.ts";
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import { loadSupplierDashboard, type SupplierDashboard } from "./supplier-dashboard-api.ts";
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
        eyebrow="Supplier workspace"
        title="We could not load your dashboard."
        message={error}
        onRetry={invalidate}
        onLogout={onLogout}
      />
    );
  }

  const summary = dashboard?.summary;
  const loading = freshness === "refreshing";

  return (
    <SupplierWorkspaceShell
      section="overview"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Supplier dashboard"
        title={`Welcome, ${firstName(userName)}.`}
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
          <DashboardRow split="6-6">
            <MetricCard
              icon={Wallet}
              label="Available payout"
              value={formatPrice(dashboard.earnings.available)}
              to="/supplier/earnings"
              linkLabel="Open earnings"
            />
            <MetricCard
              icon={Package}
              label="Orders"
              value={summary.orders}
              period="Last 30 days"
              to="/supplier/orders"
              linkLabel="View orders"
            />
          </DashboardRow>
        </>
      ) : (
        <DashboardSkeleton label="Loading your supplier dashboard…" />
      )}
    </SupplierWorkspaceShell>
  );
}
