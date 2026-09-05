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
import type { WorkspaceNavItem } from "../workspace/WorkspaceShell.tsx";
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
    copy: "Fresh orders waiting for supplier confirmation. Suppliers confirm or cancel; you start delivery once they confirm.",
    search: { view: "new" },
  },
  {
    id: "dispatched",
    label: "Out for delivery",
    icon: Truck,
    title: "Out for delivery",
    copy: "Orders handed over for delivery — dispatched or out for delivery. You keep the status current; these orders can no longer be cancelled.",
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
    copy: "Cancellation requests and cancelled orders. Suppliers approve or reject the requests; admin has read-only oversight.",
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
    copy: "Monitor every order. Suppliers confirm or cancel; admin runs the delivery process and settles refunds and COD.",
    search: {},
  },
];

export function adminOrderViewMeta(view: AdminOrderView): AdminOrderViewMeta {
  return ADMIN_ORDER_VIEWS.find((item) => item.id === view) ?? ADMIN_ORDER_VIEWS[0];
}

/** Shared admin sidebar navigation — order status lives as in-page tabs, not nested views. */
export function adminNavItems(
  activePath: string,
  _orderView: AdminOrderView = "all",
): WorkspaceNavItem[] {
  const onOrders =
    activePath.startsWith("/admin/order") || activePath.startsWith("/admin/activity");
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
      to: "/admin/order",
      icon: ClipboardList,
      label: "Orders",
      active: onOrders,
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
