import type { WorkspaceNavItem } from "../workspace/WorkspaceShell.tsx";

/** Shared admin sidebar navigation, used across every admin workspace page. */
export const ADMIN_NAV_ITEMS: readonly WorkspaceNavItem[] = [
  { to: "/admin", icon: "layers", label: "Overview" },
  { to: "/admin/activity", icon: "activity", label: "Order activity" },
  { to: "/admin/complaints", icon: "message", label: "Disputes & Claims" },
  { to: "/admin/verifications", icon: "shield-check", label: "Supplier verifications" },
  { to: "/admin/users", icon: "person", label: "User directory" },
];
