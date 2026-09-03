import { Activity, Layers, MessageSquare, ShieldCheck, Users } from "lucide-react";
import type { WorkspaceNavItem } from "../workspace/WorkspaceShell.tsx";

/** Shared admin sidebar navigation, used across every admin workspace page. */
export const ADMIN_NAV_ITEMS: readonly WorkspaceNavItem[] = [
  { to: "/admin", icon: Layers, label: "Overview" },
  { to: "/admin/activity", icon: Activity, label: "Order activity" },
  { to: "/admin/complaints", icon: MessageSquare, label: "Disputes & Claims" },
  { to: "/admin/verifications", icon: ShieldCheck, label: "Supplier verifications" },
  { to: "/admin/users", icon: Users, label: "User directory" },
];
