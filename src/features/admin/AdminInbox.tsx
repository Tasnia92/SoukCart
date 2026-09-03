import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Inbox, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
  "confirmation",
  "dispute",
  "verification",
]);
const SLA_VALUES = new Set<QueueSlaFilter>(["all", "overdue", "due_today", "due_soon"]);

type AdminInboxView = "urgent" | "queue";

type AdminInboxProps = {
  view?: AdminInboxView;
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

export function AdminInbox({ view, loadDashboard = loadAdminDashboard }: AdminInboxProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  const searchStr = useRouterState({ select: (routerState) => routerState.location.searchStr });
  const resolvedView: AdminInboxView = view ?? (pathname.endsWith("/urgent") ? "urgent" : "queue");
  const kindFilter = parseKind(searchParam(searchStr, "kind"));
  const slaFilter = parseSla(searchParam(searchStr, "sla"));

  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [notice, setNotice] = useState<{ message: string; state: NoticeState } | null>(null);

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
  const activePath = resolvedView === "urgent" ? "/admin/inbox/urgent" : "/admin/inbox/queue";

  const updateFilters = (next: { kind?: QueueKindFilter; sla?: QueueSlaFilter }) => {
    const kind = next.kind ?? kindFilter;
    const sla = next.sla ?? slaFilter;
    const search: Record<string, string> = {};
    if (kind !== "all") search.kind = kind;
    if (sla !== "all") search.sla = sla;
    void navigate({ to: activePath, search } as never);
  };

  if (error && !dashboard) {
    return (
      <WorkspaceError
        eyebrow="Admin workspace"
        title="We could not load the inbox."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const exposure = dashboard ? exposureCopy(dashboard) : "";

  return (
    <AdminWorkspaceShell
      activePath={activePath}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Inbox"
        title={resolvedView === "urgent" ? "Urgent work." : "Action queue."}
        copy={
          resolvedView === "urgent"
            ? "Items grouped by SLA. Overdue work is at the top of the list."
            : "Refunds, cancellations, confirmations, disputes, and supplier verifications waiting on an admin."
        }
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
          {resolvedView === "urgent" ? (
            <StatGrid label="SLA summary">
              <StatCard
                label="Overdue"
                value={dashboard.sla.overdue}
                detail="Past the target window"
              />
              <StatCard
                label="Due today"
                value={dashboard.sla.dueToday}
                detail="Act on these today"
              />
              <StatCard
                label="Due soon"
                value={dashboard.sla.dueSoon}
                detail="Still inside the window"
              />
              <StatCard
                label="Open items"
                value={dashboard.queue.length}
                detail="Everything waiting on you"
              />
            </StatGrid>
          ) : null}

          {resolvedView === "urgent" && exposure ? (
            <Alert>
              <Inbox />
              <AlertTitle>Monetary exposure</AlertTitle>
              <AlertDescription>{exposure}</AlertDescription>
            </Alert>
          ) : null}

          {dashboard.queue.length ? (
            <SearchToolbar
              label="Search inbox"
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
            onSlaFilter={(value) => updateFilters({ sla: value })}
            onMutated={retry}
            onNotice={setNotice}
            search={searchTerm}
            showKindFilters={resolvedView === "queue"}
          />
        </div>
      ) : (
        <LoadingState title="Loading inbox…" />
      )}
    </AdminWorkspaceShell>
  );
}
