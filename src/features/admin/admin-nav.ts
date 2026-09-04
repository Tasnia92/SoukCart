import {
  ClipboardList,
  Clock3,
  HandCoins,
  Home,
  ListChecks,
  MessageSquare,
  Package,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Users,
  Wallet,
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
    id: "all",
    label: "All orders",
    icon: ClipboardList,
    title: "All orders",
    copy: "Browse every order. Confirm, cancel, refund, or collect COD from here.",
    search: {},
  },
  {
    id: "pending",
    label: "Awaiting confirmation",
    icon: Clock3,
    title: "Awaiting confirmation",
    copy: "Paid online and cash-on-delivery orders that still need to be confirmed.",
    search: { view: "pending" },
  },
  {
    id: "confirmed",
    label: "To ship",
    icon: Package,
    title: "To ship",
    copy: "Confirmed orders waiting on the seller to send them out.",
    search: { view: "confirmed" },
  },
  {
    id: "shipped",
    label: "In transit",
    icon: Truck,
    title: "In transit",
    copy: "Shipped orders that have not been marked delivered yet.",
    search: { view: "shipped" },
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
    id: "cod",
    label: "COD to collect",
    icon: Wallet,
    title: "COD to collect",
    copy: "Cash-on-delivery orders waiting for collection to be recorded.",
    search: { view: "cod" },
  },
];

export function adminOrderViewMeta(view: AdminOrderView): AdminOrderViewMeta {
  return ADMIN_ORDER_VIEWS.find((item) => item.id === view) ?? ADMIN_ORDER_VIEWS[0];
}

/** Shared admin sidebar navigation — flat list, no nested menus. */
export function adminNavItems(activePath: string): WorkspaceNavItem[] {
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
      label: "Orders",
      active: activePath.startsWith("/admin/activity"),
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
