import { Badge } from "@/components/ui/badge";
import { Icon } from "../../components/ui/Icon.tsx";
import type { WorkspaceNavItem } from "../workspace/WorkspaceShell.tsx";
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
    <Icon name="bag" />
  );
}

type SupplierSection = "overview" | "orders" | "products" | "stock";

export function supplierNavItems(active: SupplierSection): WorkspaceNavItem[] {
  return [
    { to: "/supplier", icon: "home", label: "Overview", active: active === "overview" },
    { to: "/supplier/orders", icon: "package", label: "Orders", active: active === "orders" },
    { to: "/supplier/products", icon: "bag", label: "My products", active: active === "products" },
    { to: "/supplier/stock", icon: "layers", label: "Stock", active: active === "stock" },
  ];
}
