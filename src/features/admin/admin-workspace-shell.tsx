import type { ReactNode } from "react";
import { WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
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
  return (
    <WorkspaceShell
      navigationLabel="Admin navigation"
      items={adminNavItems(activePath)}
      userName={userName}
      userEmail={userEmail}
      onLogout={onLogout}
    >
      {children}
    </WorkspaceShell>
  );
}
