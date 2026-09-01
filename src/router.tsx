import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { renderAdminApp } from "./components/AdminApp.ts";
import { renderAuthApp } from "./components/AuthApp.ts";
import { renderPaymentResult } from "./components/PaymentResult.ts";
import { renderRetailerApp } from "./components/RetailerApp.ts";
import { renderSupplierApp } from "./components/SupplierApp.ts";

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

type LegacyRenderer = (root: HTMLDivElement) => void;
type LegacyTarget = (typeof legacyRouteContract)[number]["target"];

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

function LegacyMount({ renderer, routeKey }: { renderer: LegacyRenderer; routeKey: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) {
      return;
    }

    renderer(node);
    return () => node.replaceChildren();
  }, [renderer, routeKey]);

  return <div ref={host} className="min-h-0" data-legacy-route={routeKey} />;
}

function LegacyRoute({ target }: { target: LegacyTarget }) {
  const location = useRouterState({ select: (state) => state.location });
  const renderer =
    target === "root"
      ? shouldRenderPaymentResult({
          pathname: location.pathname,
          search: location.searchStr,
          paymentReturn: sessionStorage.getItem(FLASH_STORAGE_KEYS.paymentReturn),
        })
        ? renderPaymentResult
        : renderAuthApp
      : rendererByTarget[target];

  return <LegacyMount key={location.href} renderer={renderer} routeKey={location.href} />;
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

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFoundRedirect });

const legacyRoutes = legacyRouteContract.map(({ path, target }) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => <LegacyRoute target={target} />,
  }),
);

const routeTree = rootRoute.addChildren(legacyRoutes);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
