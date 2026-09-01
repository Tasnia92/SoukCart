import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactElement } from "react";
import { resolveAuthAccess, type AuthArea } from "./auth-access.ts";
import { renderAdminApp } from "./components/AdminApp.ts";
import { AdminAuthRoute, RootAuthRoute } from "./components/auth/AuthRoutes.tsx";
import { AdminOverview } from "./features/admin/AdminOverview.tsx";
import { AdminUsers } from "./features/admin/AdminUsers.tsx";
import { SupplierOverview } from "./features/supplier/SupplierOverview.tsx";
import { SupplierProductForm } from "./features/supplier/SupplierProductForm.tsx";
import { SupplierProducts } from "./features/supplier/SupplierProducts.tsx";
import { SupplierStock } from "./features/supplier/SupplierStock.tsx";
import { renderPaymentResult } from "./components/PaymentResult.ts";
import { renderRetailerApp } from "./components/RetailerApp.ts";
import { renderSupplierApp } from "./components/SupplierApp.ts";
import {
  sessionStore,
  type SessionState,
  type SessionStore,
  useSessionSnapshot,
} from "./session.tsx";

export const FLASH_STORAGE_KEYS = {
  notice: "soukcart:notice",
  supplierNotice: "soukcart:supplier-notice",
  paymentReturn: "soukcart:payment-return",
} as const;

export const PAYMENT_SEARCH_KEYS = ["status", "tran_id", "val_id"] as const;

export const legacyRouteContract = [
  { path: "/", target: "root" },
  { path: "/admin", target: "admin" },
  { path: "/admin/users", target: "admin" },
  { path: "/admin/activity", target: "admin" },
  { path: "/admin/complaints", target: "admin" },
  { path: "/retailer", target: "retailer" },
  { path: "/retailer/catalog", target: "retailer" },
  { path: "/retailer/cart", target: "retailer" },
  { path: "/retailer/orders", target: "retailer" },
  { path: "/retailer/orders/$orderId/invoice", target: "retailer" },
  { path: "/retailer/complaints", target: "retailer" },
  { path: "/retailer/checkout/success", target: "retailer" },
  { path: "/retailer/checkout/failed", target: "retailer" },
  { path: "/retailer/checkout/cancelled", target: "retailer" },
  { path: "/supplier", target: "supplier" },
  { path: "/supplier/orders", target: "supplier" },
  { path: "/supplier/products", target: "supplier" },
  { path: "/supplier/products/new", target: "supplier" },
  { path: "/supplier/products/$productId/edit", target: "supplier" },
  { path: "/supplier/stock", target: "supplier" },
] as const;

export const fallbackRouteContract = [
  { path: "/admin/$", to: "/admin" },
  { path: "/retailer/$", to: "/retailer" },
  { path: "/supplier/$", to: "/supplier" },
  { path: "$", to: "/" },
] as const;

export const publicPaymentResultPaths = [
  "/retailer/checkout/success",
  "/retailer/checkout/failed",
  "/retailer/checkout/cancelled",
] as const;

export function isReactOverviewRoute(pathname: string, target: "admin" | "supplier"): boolean {
  return (
    (target === "admin" && pathname === "/admin") ||
    (target === "supplier" && pathname === "/supplier")
  );
}

type LegacyRenderer = (root: HTMLDivElement) => void;
type LegacyRouteEntry = (typeof legacyRouteContract)[number];
type LegacyTarget = LegacyRouteEntry["target"];
type RouterContext = { session: SessionStore };

const publicPaymentPathSet = new Set<string>(publicPaymentResultPaths);

const rendererByTarget = {
  admin: renderAdminApp,
  retailer: renderRetailerApp,
  supplier: renderSupplierApp,
} satisfies Record<Exclude<LegacyTarget, "root">, LegacyRenderer>;

export function shouldRenderPaymentResult({
  pathname,
  search,
  paymentReturn,
}: {
  pathname: string;
  search: string;
  paymentReturn: string | null;
}): boolean {
  return (
    pathname === "/" &&
    (Boolean(new URLSearchParams(search).get("status")) || Boolean(paymentReturn))
  );
}

function getPaymentReturn(): string | null {
  return sessionStorage.getItem(FLASH_STORAGE_KEYS.paymentReturn);
}

function isRootPaymentLocation(location: { pathname: string; searchStr: string }): boolean {
  return shouldRenderPaymentResult({
    pathname: location.pathname,
    search: location.searchStr,
    paymentReturn: getPaymentReturn(),
  });
}

export async function guardAuthArea(store: SessionStore, area: AuthArea): Promise<void> {
  const state = await store.ensureReady();
  const decision = resolveAuthAccess(area, state);

  switch (decision.kind) {
    case "render":
      return;
    case "redirect":
      throw redirect({ href: decision.to, replace: true });
    case "deny-admin":
      await store.denyAdminAccess();
      return;
    case "sign-out-redirect":
      await store.signOutForGuard();
      throw redirect({ href: decision.to, replace: true });
  }
}

function routeArea({ path, target }: LegacyRouteEntry): AuthArea {
  if (publicPaymentPathSet.has(path)) return "public-payment";
  if (target === "root") return "root";
  return target === "supplier" ? "supplier" : target;
}

function canMountProtectedTarget(state: SessionState, target: Exclude<LegacyTarget, "root">) {
  if (target === "admin") return state.status === "admin";
  if (target === "retailer") return state.status === "retailer";
  return state.status === "seller";
}

function LegacyMount({ renderer, routeKey }: { renderer: LegacyRenderer; routeKey: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;

    renderer(node);
    return () => node.replaceChildren();
  }, [renderer, routeKey]);

  return <div ref={host} className="min-h-0" data-legacy-route={routeKey} />;
}

function LegacyRoute({ target }: { target: Exclude<LegacyTarget, "root"> }): ReactElement {
  const location = useRouterState({ select: (state) => state.location });
  return (
    <LegacyMount key={location.href} renderer={rendererByTarget[target]} routeKey={location.href} />
  );
}

function ProtectedLegacyRoute({
  target,
}: {
  target: Exclude<LegacyTarget, "root">;
}): ReactElement | null {
  const { state } = useSessionSnapshot();
  return canMountProtectedTarget(state, target) ? <LegacyRoute target={target} /> : null;
}

function RootRoute(): ReactElement {
  const location = useRouterState({ select: (state) => state.location });
  if (isRootPaymentLocation(location)) {
    return (
      <LegacyMount key={location.href} renderer={renderPaymentResult} routeKey={location.href} />
    );
  }
  return <RootAuthRoute />;
}

function AdminRoute(): ReactElement {
  const { state } = useSessionSnapshot();
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  if (state.status !== "admin") return <AdminAuthRoute />;
  if (isReactOverviewRoute(pathname, "admin")) return <AdminOverview />;
  if (pathname === "/admin/users") return <AdminUsers />;
  return <LegacyRoute target="admin" />;
}

const SUPPLIER_EDIT_PATTERN = /^\/supplier\/products\/([^/]+)\/edit$/;

function reactSupplierPanel(pathname: string): ReactElement | null {
  if (isReactOverviewRoute(pathname, "supplier")) return <SupplierOverview />;
  if (pathname === "/supplier/products") return <SupplierProducts />;
  if (pathname === "/supplier/products/new") return <SupplierProductForm />;
  if (pathname === "/supplier/stock") return <SupplierStock />;
  const editMatch = SUPPLIER_EDIT_PATTERN.exec(pathname);
  if (editMatch) return <SupplierProductForm productId={editMatch[1]} />;
  return null;
}

function SupplierRoute(): ReactElement | null {
  const { state } = useSessionSnapshot();
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  if (state.status === "seller") {
    const panel = reactSupplierPanel(pathname);
    if (panel) return panel;
  }
  return <ProtectedLegacyRoute target="supplier" />;
}

function routeComponent({ path, target }: LegacyRouteEntry): () => ReactElement | null {
  if (target === "root") return RootRoute;
  if (target === "admin") return AdminRoute;
  if (target === "supplier") return SupplierRoute;
  if (publicPaymentPathSet.has(path)) return () => <LegacyRoute target={target} />;
  return () => <ProtectedLegacyRoute target={target} />;
}

export function getFallbackDestination(
  pathname: string,
): "/" | "/admin" | "/retailer" | "/supplier" {
  const familyFallback = fallbackRouteContract.find(
    ({ path }) => path !== "$" && pathname.startsWith(path.slice(0, -1)),
  );
  return familyFallback?.to ?? "/";
}

function NotFoundRedirect() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const destination = getFallbackDestination(pathname);

  useEffect(() => window.location.replace(destination), [destination]);
  return null;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundRedirect,
});

const legacyRoutes = legacyRouteContract.map((entry) => {
  const area = routeArea(entry);
  return createRoute({
    getParentRoute: () => rootRoute,
    path: entry.path,
    beforeLoad: async ({ context, location }) => {
      if (area === "public-payment" || (area === "root" && isRootPaymentLocation(location))) {
        return;
      }
      await guardAuthArea(context.session, area);
    },
    component: routeComponent(entry),
  });
});

const routeTree = rootRoute.addChildren(legacyRoutes);

export const router = createRouter({ routeTree, context: { session: sessionStore } });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
