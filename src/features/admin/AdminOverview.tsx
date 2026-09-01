import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  InlineNotice,
  LoadingState,
  PageHeader,
  StatCard,
  StatGrid,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  getAdminOverviewStats,
  loadAdminOverviewUsers,
  type AdminOverviewUser,
} from "./admin-overview-api.ts";

type AdminOverviewProps = {
  loadUsers?: () => Promise<AdminOverviewUser[]>;
};

export function AdminOverview({ loadUsers = loadAdminOverviewUsers }: AdminOverviewProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const [users, setUsers] = useState<AdminOverviewUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);

    void loadUsers()
      .then((nextUsers) => {
        if (current) setUsers(nextUsers);
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
  }, [loadUsers, loadVersion]);

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

  const stats = users ? getAdminOverviewStats(users) : null;
  return (
    <WorkspaceShell
      navigationLabel="Admin navigation"
      items={[
        { to: "/admin", icon: "layers", label: "Overview", active: true },
        { to: "/admin/activity", icon: "activity", label: "Order activity" },
        { to: "/admin/complaints", icon: "message", label: "Disputes & Claims" },
        { to: "/admin/users", icon: "person", label: "User directory" },
      ]}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="System overview"
        title="Everything in sync."
        actions={
          <Button variant="subtle" disabled={loading} onClick={retry}>
            <Icon name="refresh" />
            <span>Refresh</span>
          </Button>
        }
      />
      <InlineNotice />
      {stats ? (
        <StatGrid label="System statistics">
          <StatCard label="Total accounts" value={stats.total} detail="All registered users" />
          <StatCard label="Seen in 30 days" value={stats.recentlyActive} detail="Recent sign-ins" />
          <StatCard label="New this week" value={stats.newThisWeek} detail="Fresh registrations" />
          <StatCard label="Needs setup" value={stats.needsSetup} detail="No account type yet" />
        </StatGrid>
      ) : (
        <LoadingState title="Loading the admin workspace…" />
      )}
    </WorkspaceShell>
  );
}
