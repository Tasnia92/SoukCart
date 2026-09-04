import {
  AlertTriangle,
  Banknote,
  ClipboardList,
  Clock3,
  HandCoins,
  Inbox,
  Layers,
  ListTodo,
  MessageSquare,
  Package,
  ShieldCheck,
  ShoppingBag,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceNavItem, WorkspaceNavMenuChoice } from "../workspace/WorkspaceShell.tsx";
import { parseAdminOrderView, type AdminOrderView } from "./admin-activity-api.ts";

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
    title: "Every order, end to end.",
    copy: "Approve cancellations, calculate refundable amounts, and record manual refunds.",
    search: {},
  },
  {
    id: "pending",
    label: "Awaiting confirmation",
    icon: Clock3,
    title: "Orders waiting on confirmation.",
    copy: "Paid online and cash-on-delivery orders that still need to be confirmed.",
    search: { view: "pending" },
  },
  {
    id: "confirmed",
    label: "To ship",
    icon: Package,
    title: "Orders ready to ship.",
    copy: "Confirmed orders waiting on the seller to send them out.",
    search: { view: "confirmed" },
  },
  {
    id: "shipped",
    label: "In transit",
    icon: Truck,
    title: "Orders on the way.",
    copy: "Shipped orders that have not been marked delivered yet.",
    search: { view: "shipped" },
  },
  {
    id: "cancellations",
    label: "Cancellations",
    icon: AlertTriangle,
    title: "Cancellations.",
    copy: "Cancel requests and cancelled orders.",
    search: { view: "cancellations" },
  },
  {
    id: "refunds",
    label: "Refunds",
    icon: Banknote,
    title: "Refunds to complete.",
    copy: "Manual refunds that still need review or completion.",
    search: { view: "refunds" },
  },
  {
    id: "cod",
    label: "COD to collect",
    icon: Wallet,
    title: "Cash on delivery to settle.",
    copy: "SoukCart records COD after the delivery partner collects cash. Settle these before the invoice is issued.",
    search: { view: "cod" },
  },
];

export function adminOrderViewMeta(view: AdminOrderView): AdminOrderViewMeta {
  return ADMIN_ORDER_VIEWS.find((item) => item.id === view) ?? ADMIN_ORDER_VIEWS[0];
}

function isChoiceActive(
  choice: Pick<WorkspaceNavMenuChoice, "to" | "search">,
  activePath: string,
  orderView: AdminOrderView,
): boolean {
  if (!choice.to) return false;
  if (choice.to === "/admin/activity") {
    const expected = parseAdminOrderView(choice.search?.view ?? null);
    return activePath.startsWith("/admin/activity") && orderView === expected;
  }
  return choice.to === activePath;
}

/** Shared admin sidebar navigation, used across every admin workspace page. */
export function adminNavItems(activePath: string, orderView: AdminOrderView): WorkspaceNavItem[] {
  const orderChoices = ADMIN_ORDER_VIEWS.map((view) => ({
    id: view.id,
    label: view.label,
    icon: view.icon,
    to: "/admin/activity" as const,
    search: view.search,
    active: isChoiceActive({ to: "/admin/activity", search: view.search }, activePath, orderView),
  }));

  return [
    {
      to: "/admin",
      icon: Layers,
      label: "Overview",
      active: activePath === "/admin",
    },
    {
      to: "/admin/inbox/queue",
      icon: Inbox,
      label: "Inbox",
      active: activePath.startsWith("/admin/inbox"),
      menu: [
        {
          id: "urgent",
          label: "Urgent work",
          icon: AlertTriangle,
          to: "/admin/inbox/urgent",
          active: isChoiceActive({ to: "/admin/inbox/urgent" }, activePath, orderView),
        },
        {
          id: "queue",
          label: "Action queue",
          icon: ListTodo,
          to: "/admin/inbox/queue",
          active: isChoiceActive({ to: "/admin/inbox/queue" }, activePath, orderView),
        },
      ],
    },
    {
      to: "/admin/activity",
      icon: ShoppingBag,
      label: "Orders",
      active: activePath.startsWith("/admin/activity"),
      menu: orderChoices,
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
      label: "Disputes & Claims",
      active: activePath.startsWith("/admin/complaints"),
    },
    {
      to: "/admin/verifications",
      icon: ShieldCheck,
      label: "Supplier verifications",
      active: activePath.startsWith("/admin/verifications"),
    },
    {
      to: "/admin/users",
      icon: Users,
      label: "User directory",
      active: activePath.startsWith("/admin/users"),
    },
  ];
}
