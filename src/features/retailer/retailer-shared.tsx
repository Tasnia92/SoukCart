import type { ReactNode } from "react";
import {
  Bell,
  House,
  MessageSquare,
  Package,
  Settings,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { WorkspaceShell, type WorkspaceNavItem } from "../workspace/WorkspaceShell.tsx";

export type RetailerSection =
  | "overview"
  | "catalog"
  | "cart"
  | "checkout"
  | "orders"
  | "complaints"
  | "notifications"
  | "settings";

export type RetailerNavBadges = {
  cartCount?: number;
  unreadNotifications?: number;
};

export function RetailerWorkspaceShell({
  section,
  userName,
  userEmail,
  cartCount = 0,
  unreadNotifications = 0,
  onLogout,
  children,
}: {
  section: RetailerSection;
  userName: string;
  userEmail: string;
  cartCount?: number;
  unreadNotifications?: number;
  onLogout: () => void;
  children: ReactNode;
}) {
  return (
    <WorkspaceShell
      navigationLabel="Retailer navigation"
      items={retailerNavItems(section, { cartCount, unreadNotifications })}
      userName={userName}
      userEmail={userEmail}
      onLogout={onLogout}
    >
      {children}
    </WorkspaceShell>
  );
}

export function retailerNavItems(
  active: RetailerSection,
  badges: RetailerNavBadges = {},
): WorkspaceNavItem[] {
  const accountActive =
    active === "complaints" || active === "notifications" || active === "settings";

  return [
    {
      to: "/retailer",
      icon: House,
      label: "Overview",
      active: active === "overview",
    },
    {
      to: "/retailer/catalog",
      icon: ShoppingBag,
      label: "Place order",
      active: active === "catalog",
    },
    {
      to: "/retailer/cart",
      icon: ShoppingCart,
      label: "Cart",
      active: active === "cart" || active === "checkout",
      trailing: badges.cartCount || undefined,
    },
    {
      to: "/retailer/orders",
      icon: Package,
      label: "My orders",
      active: active === "orders",
    },
    {
      icon: Settings,
      label: "Account",
      active: accountActive,
      trailing: badges.unreadNotifications || undefined,
      menu: [
        {
          id: "notifications",
          label: "Notifications",
          icon: Bell,
          to: "/retailer/notifications",
          active: active === "notifications",
        },
        {
          id: "complaints",
          label: "Help Center",
          icon: MessageSquare,
          to: "/retailer/complaints",
          active: active === "complaints",
        },
        {
          id: "settings",
          label: "Settings",
          icon: Settings,
          to: "/retailer/settings",
          active: active === "settings",
        },
      ],
    },
  ];
}
