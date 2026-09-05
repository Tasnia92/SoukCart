import {
  ClipboardList,
  Clock3,
  HandCoins,
  Home,
  ListChecks,
  MessageSquare,
  PackageCheck,
  ShieldAlert,
  ShieldCheck,
  Tags,
  Truck,
  Users,
  AlertTriangle,
  Banknote,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceNavMenuChoice, WorkspaceNavItem } from "../workspace/WorkspaceShell.tsx";
import type { AdminOrderView } from "./admin-activity-api.ts";

export type AdminOrderViewMeta = {
  id: AdminOrderView;
  label: string;
  icon: LucideIcon;
  title: string;
  copy: string;
  search: Record<string, string>;
};

export const ADMIN_ORDER_VIEWS: readonly AdminOrderViewMeta[] = [
  {
    id: "new",
    label: "New orders",
    icon: Clock3,
    title: "New orders",
    copy: "Fresh orders waiting to be dispatched to the courier.",
    search: { view: "new" },
  },
  {
    id: "dispatched",
    label: "Dispatched",
    icon: Truck,
    title: "Dispatched",
    copy: "Orders on the way. Mark them delivered once they arrive.",
    search: { view: "dispatched" },
  },
  {
    id: "delivered",
    label: "Delivered",
    icon: PackageCheck,
    title: "Delivered",
    copy: "Completed orders that arrived at the retailer.",
    search: { view: "delivered" },
  },
  {
    id: "cancellations",
    label: "Cancellations",
    icon: AlertTriangle,
    title: "Cancellations",
    copy: "Cancel requests and cancelled orders.",
    search: { view: "cancellations" },
  },
  {
    id: "refunds",
    label: "Refunds",
    icon: Banknote,
    title: "Refunds",
    copy: "Manual refunds that still need review or completion.",
    search: { view: "refunds" },
  },
  {
    id: "all",
    label: "All orders",
    icon: ClipboardList,
    title: "All orders",
    copy: "Browse every order. Update delivery status, cancel, refund, or collect COD from here.",
    search: {},
  },
];

export function adminOrderViewMeta(view: AdminOrderView): AdminOrderViewMeta {
  return ADMIN_ORDER_VIEWS.find((item) => item.id === view) ?? ADMIN_ORDER_VIEWS[0];
}

/** Shared admin sidebar navigation — order views collapse under "Order management". */
export function adminNavItems(
  activePath: string,
  orderView: AdminOrderView = "all",
): WorkspaceNavItem[] {
  const onOrders = activePath.startsWith("/admin/activity");
  return [
    {
      to: "/admin",
      icon: Home,
      label: "Home",
      active: activePath === "/admin",
    },
    {
      to: "/admin/inbox",
      icon: ListChecks,
      label: "Needs attention",
      active: activePath.startsWith("/admin/inbox"),
    },
    {
      to: "/admin/activity",
      icon: ClipboardList,
      label: "Order management",
      active: onOrders,
      menu: ADMIN_ORDER_VIEWS.map(
        (view): WorkspaceNavMenuChoice => ({
          id: view.id,
          label: view.label,
          icon: view.icon,
          to: "/admin/activity",
          search: view.search,
          active: onOrders && view.id === orderView,
        }),
      ),
    },
    {
      to: "/admin/payouts",
      icon: HandCoins,
      label: "Payouts",
      active: activePath.startsWith("/admin/payouts"),
    },
    {
      to: "/admin/complaints",
      icon: MessageSquare,
      label: "Disputes",
      active: activePath.startsWith("/admin/complaints"),
    },
    {
      to: "/admin/products",
      icon: ShieldAlert,
      label: "Products",
      active: activePath.startsWith("/admin/products"),
    },
    {
      to: "/admin/categories",
      icon: Tags,
      label: "Categories",
      active: activePath.startsWith("/admin/categories"),
    },
    {
      to: "/admin/verifications",
      icon: ShieldCheck,
      label: "Verifications",
      active: activePath.startsWith("/admin/verifications"),
    },
    {
      to: "/admin/users",
      icon: Users,
      label: "Users",
      active: activePath.startsWith("/admin/users"),
    },
  ];
}
