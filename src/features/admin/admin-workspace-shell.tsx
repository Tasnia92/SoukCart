import type { ReactNode } from "react";
import { WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import { adminNavItems } from "./admin-nav.ts";
import type { AdminOrderView } from "./admin-activity-api.ts";

type AdminWorkspaceShellProps = {
  activePath: string;
  /** Which order view is active, so the sidebar can highlight it inside the dropdown. */
  orderView?: AdminOrderView;
  userName: string;
  userEmail: string;
  onLogout: () => void;
  children: ReactNode;
};

export function AdminWorkspaceShell({
  activePath,
  orderView,
  userName,
  userEmail,
  onLogout,
  children,
}: AdminWorkspaceShellProps) {
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
