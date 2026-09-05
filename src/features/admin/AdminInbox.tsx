import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ADMIN_SLA_LABELS } from "./admin-dashboard-api.ts";
import {
  InlineNotice,
  LoadingState,
  PageHeader,
  SearchToolbar,
  StatCard,
  StatGrid,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { searchParam } from "../workspace/search.ts";
import { useTableChanges } from "../../workspace-realtime.ts";
import { loadAdminDashboard, type AdminDashboard } from "./admin-dashboard-api.ts";
import {
  AdminActionWorkspace,
  exposureCopy,
  type QueueKindFilter,
  type QueueSlaFilter,
} from "./admin-overview-panels.tsx";
import { AdminWorkspaceShell } from "./admin-workspace-shell.tsx";

const ADMIN_LIVE_TABLES = ["orders", "complaints", "supplier_profiles"] as const;
const KIND_VALUES = new Set<QueueKindFilter>([
  "all",
  "refund",
  "cancellation",
  "dispute",
  "verification",
]);
const SLA_VALUES = new Set<QueueSlaFilter>(["all", "overdue", "due_today", "due_soon"]);

type AdminInboxProps = {
  loadDashboard?: () => Promise<AdminDashboard>;
};

function parseKind(value: string | null): QueueKindFilter {
  if (value && KIND_VALUES.has(value as QueueKindFilter)) return value as QueueKindFilter;
  return "all";
}

function parseSla(value: string | null): QueueSlaFilter {
  if (value && SLA_VALUES.has(value as QueueSlaFilter)) return value as QueueSlaFilter;
  return "all";
}

export function AdminInbox({ loadDashboard = loadAdminDashboard }: AdminInboxProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  const searchStr = useRouterState({ select: (routerState) => routerState.location.searchStr });
  const kindFilter = parseKind(searchParam(searchStr, "kind"));
  const slaFilter = parseSla(searchParam(searchStr, "sla"));

  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [notice, setNotice] = useState<{ message: string; state: NoticeState } | null>(null);

  // Canonicalize legacy /admin/inbox/urgent and /admin/inbox/queue URLs.
  useEffect(() => {
    if (pathname === "/admin/inbox/urgent" || pathname === "/admin/inbox/queue") {
      const search: Record<string, string> = {};
      if (kindFilter !== "all") search.kind = kindFilter;
      if (slaFilter !== "all") search.sla = slaFilter;
      void navigate({ to: "/admin/inbox", search, replace: true } as never);
    }
  }, [pathname, kindFilter, slaFilter, navigate]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    void loadDashboard()
      .then((next) => {
        if (!current) return;
        setDashboard(next);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!current) return;
        setError(loadError instanceof Error ? loadError.message : "Please try again.");
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

  const updateFilters = (next: { kind?: QueueKindFilter; sla?: QueueSlaFilter }) => {
    const kind = next.kind ?? kindFilter;
    const sla = next.sla ?? slaFilter;
    const search: Record<string, string> = {};
    if (kind !== "all") search.kind = kind;
    if (sla !== "all") search.sla = sla;
    void navigate({ to: "/admin/inbox", search } as never);
  };

  if (error && !dashboard) {
    return (
      <WorkspaceError
        eyebrow="Admin"
        title="We could not load work that needs attention."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const exposure = dashboard ? exposureCopy(dashboard) : "";

  return (
    <AdminWorkspaceShell
      activePath="/admin/inbox"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Needs attention"
        title="Work waiting on you."
        copy="Overdue items are listed first. Finish refunds, resolve disputes, and open verifications from here."
        actions={
          <Button type="button" variant="ghost" disabled={loading} onClick={retry}>
            {loading ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            Refresh
          </Button>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />

      {dashboard ? (
        <div className="db-inbox flex flex-col gap-6">
          <StatGrid label="Due status">
            <StatCard
              label="Overdue"
              value={dashboard.sla.overdue}
              detail={
                <button
                  type="button"
                  className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => updateFilters({ sla: "overdue" })}
                >
                  Show overdue
                </button>
              }
            />
            <StatCard
              label="Due today"
              value={dashboard.sla.dueToday}
              detail={
                <button
                  type="button"
                  className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => updateFilters({ sla: "due_today" })}
                >
                  Show due today
                </button>
              }
            />
            <StatCard
              label="Due soon"
              value={dashboard.sla.dueSoon}
              detail={
                <button
                  type="button"
                  className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => updateFilters({ sla: "due_soon" })}
                >
                  Show due soon
                </button>
              }
            />
            <StatCard
              label="Open items"
              value={dashboard.queue.length}
              detail={
                <button
                  type="button"
                  className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => updateFilters({ sla: "all", kind: "all" })}
                >
                  Show all
                </button>
              }
            />
          </StatGrid>

          {exposure ? (
            <p className="text-sm text-muted-foreground">Money still open: {exposure}</p>
          ) : null}

          {slaFilter !== "all" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Showing</span>
              <Badge variant="secondary">{ADMIN_SLA_LABELS[slaFilter]}</Badge>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => updateFilters({ sla: "all" })}
              >
                <X data-icon="inline-start" />
                Clear due filter
              </Button>
            </div>
          ) : null}

          {dashboard.queue.length ? (
            <SearchToolbar
              label="Search work"
              placeholder="Search by title, retailer, shop, or record id"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              result={`${dashboard.queue.length} open`}
            />
          ) : null}

          <AdminActionWorkspace
            dashboard={dashboard}
            kindFilter={kindFilter}
            slaFilter={slaFilter}
            onKindFilter={(value) => updateFilters({ kind: value })}
            onMutated={retry}
            onNotice={setNotice}
            search={searchTerm}
            showKindFilters
          />
        </div>
      ) : (
        <LoadingState title="Loading work that needs attention…" />
      )}
    </AdminWorkspaceShell>
  );
}
