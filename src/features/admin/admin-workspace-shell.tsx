import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import { searchParam } from "../workspace/search.ts";
import { parseAdminOrderView } from "./admin-activity-api.ts";
import { adminNavItems } from "./admin-nav.ts";

type AdminWorkspaceShellProps = {
  activePath: string;
  userName: string;
  userEmail: string;
  onLogout: () => void;
  children: ReactNode;
};

export function AdminWorkspaceShell({
  activePath,
  userName,
  userEmail,
  onLogout,
  children,
}: AdminWorkspaceShellProps) {
  const searchStr = useRouterState({ select: (routerState) => routerState.location.searchStr });
  const orderView = parseAdminOrderView(searchParam(searchStr, "view"));

  return (
    <WorkspaceShell
      navigationLabel="Admin navigation"
      items={adminNavItems(activePath, orderView)}
      userName={userName}
      userEmail={userEmail}
      onLogout={onLogout}
    >
      {children}
    </WorkspaceShell>
  );
}
