import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  LayoutDashboard,
  PackageCheck,
  PackageOpen,
  RotateCcw,
  Settings,
  ShoppingBag,
  Users,
  Wallet,
  Warehouse,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTableChanges } from "../../workspace-realtime.ts";
import { useProductChanges } from "../../product-realtime.ts";
import { WorkspaceShell, type WorkspaceNavItem } from "../workspace/WorkspaceShell.tsx";
import {
  EMPTY_SELLER_NAV_BADGES,
  loadSellerNavBadges,
  type SellerNavBadges,
} from "./supplier-dashboard-api.ts";
import type { SupplierProduct } from "./supplier-overview-api.ts";

export const SUPPLIER_NOTICE_KEY = "soukcart:supplier-notice";

export type SupplierNotice = { message: string; state: "info" | "success" | "error" };

export function consumeSupplierNotice(): SupplierNotice | null {
  if (typeof sessionStorage === "undefined") return null;
  const message = sessionStorage.getItem(SUPPLIER_NOTICE_KEY);
  if (!message) return null;
  sessionStorage.removeItem(SUPPLIER_NOTICE_KEY);
  return { message, state: "success" };
}

export function StockChip({ product }: { product: Pick<SupplierProduct, "is_active" | "stock"> }) {
  if (!product.is_active) return <Badge variant="secondary">Hidden</Badge>;
  if (product.stock <= 0) return <Badge variant="destructive">Out of stock</Badge>;
  return <Badge>Active</Badge>;
}

export function ProductThumb({ product }: { product: Pick<SupplierProduct, "image_url"> }) {
  return product.image_url ? (
    <img src={product.image_url} alt="" loading="lazy" className="size-full object-cover" />
  ) : (
    <ShoppingBag aria-hidden="true" />
  );
}

export type SupplierSection =
  | "overview"
  | "orders"
  | "products"
  | "stock"
  | "earnings"
  | "returns"
  | "customers"
  | "notifications"
  | "settings";

export function SupplierWorkspaceShell({
  section,
  userName,
  userEmail,
  onLogout,
  children,
}: {
  section: SupplierSection;
  userName: string;
  userEmail: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [badges, setBadges] = useState<SellerNavBadges>(EMPTY_SELLER_NAV_BADGES);
  const [badgeVersion, setBadgeVersion] = useState(0);
  const refreshBadges = useCallback(() => setBadgeVersion((version) => version + 1), []);

  useEffect(() => {
    let current = true;
    void loadSellerNavBadges()
      .then((next) => {
        if (current) setBadges(next);
      })
      .catch(() => {
        // Badges are supplemental; keep the last known counts.
      });
    return () => {
      current = false;
    };
  }, [badgeVersion, section]);

  useTableChanges({
    enabled: true,
    tables: ["orders", "seller_payouts", "notifications", "order_returns"],
    onChange: refreshBadges,
    coalesceMs: 1500,
  });

  useProductChanges({
    enabled: true,
    onChange: refreshBadges,
    coalesceMs: 800,
  });

  return (
    <WorkspaceShell
      navigationLabel="Seller workspace navigation"
      items={supplierNavItems(section, badges)}
      userName={userName}
      userEmail={userEmail}
      verified
      onLogout={onLogout}
    >
      {children}
    </WorkspaceShell>
  );
}

export function supplierNavItems(
  active: SupplierSection,
  badges: SellerNavBadges = EMPTY_SELLER_NAV_BADGES,
): WorkspaceNavItem[] {
  return [
    {
      to: "/supplier",
      icon: LayoutDashboard,
      label: "Dashboard",
      active: active === "overview",
    },
    {
      to: "/supplier/orders",
      icon: PackageCheck,
      label: "Orders",
      active: active === "orders",
      trailing: badges.needsAction > 0 ? badges.needsAction : undefined,
    },
    {
      to: "/supplier/products",
      icon: PackageOpen,
      label: "Products",
      active: active === "products",
    },
    {
      to: "/supplier/stock",
      icon: Warehouse,
      label: "Inventory",
      active: active === "stock",
      trailing: badges.stockAtRisk > 0 ? badges.stockAtRisk : undefined,
    },
    {
      to: "/supplier/earnings",
      icon: Wallet,
      label: "Earnings",
      active: active === "earnings",
    },
    {
      to: "/supplier/returns",
      icon: RotateCcw,
      label: "Returns",
      active: active === "returns",
      trailing: badges.openReturns > 0 ? badges.openReturns : undefined,
    },
    {
      to: "/supplier/customers",
      icon: Users,
      label: "Customers",
      active: active === "customers",
    },
    {
      to: "/supplier/notifications",
      icon: Bell,
      label: "Notifications",
      active: active === "notifications",
      trailing: badges.unreadNotifications > 0 ? badges.unreadNotifications : undefined,
    },
    {
      to: "/supplier/settings",
      icon: Settings,
      label: "Settings",
      active: active === "settings",
    },
  ];
}
