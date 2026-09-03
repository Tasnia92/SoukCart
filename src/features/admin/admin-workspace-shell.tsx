import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import { ADMIN_NAV_ITEMS } from "./admin-nav.ts";

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
  const items = [
    ...ADMIN_NAV_ITEMS.slice(0, 1).map((item) => ({
      ...item,
      active: item.to === activePath,
    })),
    {
      icon: Inbox,
      label: "Inbox",
      active: activePath.startsWith("/admin/inbox"),
      menu: [
        { id: "urgent", label: "Urgent work", to: "/admin/inbox/urgent" as const },
        { id: "queue", label: "Action queue", to: "/admin/inbox/queue" as const },
      ],
    },
    ...ADMIN_NAV_ITEMS.slice(1).map((item) => ({
      ...item,
      active: Boolean(item.to && item.to !== "/admin" && activePath.startsWith(item.to)),
    })),
  ];

  return (
    <WorkspaceShell
      navigationLabel="Admin navigation"
      items={items}
      userName={userName}
      userEmail={userEmail}
      onLogout={onLogout}
    >
      {children}
    </WorkspaceShell>
  );
}
