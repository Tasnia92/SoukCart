import type { Session } from "@supabase/supabase-js";
import { describe, expect, it } from "vite-plus/test";
import {
  fallbackRouteContract,
  FLASH_STORAGE_KEYS,
  getFallbackDestination,
  isReactOverviewRoute,
  PAYMENT_SEARCH_KEYS,
  publicPaymentResultPaths,
  routeContract,
  router,
  shouldRenderPaymentResult,
} from "./router.tsx";
import { SessionStore, type Profile, type SessionGateway } from "./session.tsx";

const expectedRoutes = {
  "/": "root",
  "/admin": "admin",
  "/admin/users": "admin",
  "/admin/activity": "admin",
  "/admin/complaints": "admin",
  "/admin/verifications": "admin",
  "/admin/verifications/$userId": "admin",
  "/retailer": "retailer",
  "/retailer/catalog": "retailer",
  "/retailer/cart": "retailer",
  "/retailer/orders": "retailer",
  "/retailer/orders/$orderId/invoice": "retailer",
  "/retailer/complaints": "retailer",
  "/retailer/checkout/success": "retailer",
  "/retailer/checkout/failed": "retailer",
  "/retailer/checkout/cancelled": "retailer",
  "/supplier": "supplier",
  "/supplier/orders": "supplier",
  "/supplier/products": "supplier",
  "/supplier/products/new": "supplier",
  "/supplier/products/$productId/edit": "supplier",
  "/supplier/stock": "supplier",
};

type BeforeLoad = (options: {
  context: { session: SessionStore };
  location: { pathname: string; searchStr: string };
}) => Promise<void>;

function beforeLoad(path: keyof typeof router.routesByPath): BeforeLoad {
  const handler = router.routesByPath[path].options.beforeLoad;
  if (!handler) throw new Error(`Expected ${String(path)} to have a beforeLoad guard`);
  return handler as unknown as BeforeLoad;
}

function session(id: string): Session {
  return { user: { id } } as Session;
}

function gatewayFor(profile: Profile | null) {
  let signOutCalls = 0;
  const gateway: SessionGateway = {
    getSession: async () => ({ session: null, error: null }),
    getProfile: async () => ({ profile, error: null }),
    subscribe: () => () => undefined,
    signIn: async () => ({ error: null }),
    signUp: async () => ({ error: null }),
    signOut: async () => {
      signOutCalls += 1;
      return { error: null };
    },
    updateRole: async () => ({ error: null }),
  };
  return { gateway, signOutCalls: () => signOutCalls };
}

async function captureRejection(work: Promise<void>): Promise<unknown> {
  try {
    await work;
    return null;
  } catch (error) {
    return error;
  }
}

describe("route contract", () => {
  it("maps every inventory route to its preserved route target", () => {
    expect(Object.fromEntries(routeContract.map(({ path, target }) => [path, target]))).toEqual(
      expectedRoutes,
    );
  });

  it("gives root and admin auth states to React and guards every inventory route", () => {
    expect(router.routesByPath["/"].options.component?.name).toBe("RootRoute");
    for (const path of [
      "/admin",
      "/admin/users",
      "/admin/activity",
      "/admin/complaints",
      "/admin/verifications",
      "/admin/verifications/$userId",
    ] as const) {
      expect(router.routesByPath[path].options.component?.name).toBe("AdminRoute");
    }
    for (const { path } of routeContract) {
      expect(router.routesByPath[path].options.beforeLoad).toBeTypeOf("function");
    }
  });

  it("uses React only for the exact Phase 4 overview URLs", () => {
    expect(isReactOverviewRoute("/admin", "admin")).toBe(true);
    expect(isReactOverviewRoute("/supplier", "supplier")).toBe(true);
    expect(isReactOverviewRoute("/admin/users", "admin")).toBe(false);
    expect(isReactOverviewRoute("/admin/activity", "admin")).toBe(false);
    expect(isReactOverviewRoute("/admin/complaints", "admin")).toBe(false);
    expect(isReactOverviewRoute("/supplier/orders", "supplier")).toBe(false);
    expect(isReactOverviewRoute("/supplier/products", "supplier")).toBe(false);
    expect(isReactOverviewRoute("/supplier/products/new", "supplier")).toBe(false);
    expect(isReactOverviewRoute("/supplier/stock", "supplier")).toBe(false);
  });

  it("keeps checkout result routes public under the retailer route family", () => {
    expect(publicPaymentResultPaths).toEqual([
      "/retailer/checkout/success",
      "/retailer/checkout/failed",
      "/retailer/checkout/cancelled",
    ]);
    expect(
      routeContract
        .filter(({ path }) => publicPaymentResultPaths.includes(path as never))
        .map(({ target }) => target),
    ).toEqual(["retailer", "retailer", "retailer"]);
  });

  it("redirects unknown paths to the safe family overview", () => {
    expect(fallbackRouteContract).toEqual([
      { path: "/admin/$", to: "/admin" },
      { path: "/retailer/$", to: "/retailer" },
      { path: "/supplier/$", to: "/supplier" },
      { path: "$", to: "/" },
    ]);
    expect(getFallbackDestination("/admin/unknown")).toBe("/admin");
    expect(getFallbackDestination("/retailer/unknown")).toBe("/retailer");
    expect(getFallbackDestination("/supplier/unknown")).toBe("/supplier");
    expect(getFallbackDestination("/adminfoo")).toBe("/");
    expect(getFallbackDestination("/unknown")).toBe("/");
  });

  it("preserves payment and flash key names", () => {
    expect(PAYMENT_SEARCH_KEYS).toEqual(["status", "tran_id", "val_id"]);
    expect(FLASH_STORAGE_KEYS).toEqual({
      notice: "soukcart:notice",
      supplierNotice: "soukcart:supplier-notice",
      paymentReturn: "soukcart:payment-return",
    });
  });
});

describe("composed route guards", () => {
  it("signs a non-admin out once and retains the embedded admin error", async () => {
    const userSession = session("retailer-1");
    const fake = gatewayFor({
      id: "retailer-1",
      email: "retailer@example.com",
      name: "Retailer",
      role: "retailer",
    });
    const store = new SessionStore(fake.gateway);
    await store.refresh(userSession);

    await beforeLoad("/admin")({
      context: { session: store },
      location: { pathname: "/admin", searchStr: "" },
    });

    expect(fake.signOutCalls()).toBe(1);
    expect(store.getSnapshot()).toEqual({
      state: { status: "signed-out" },
      adminError: "This account is not an admin.",
    });
  });

  it("signs out a missing-profile protected user before redirecting home", async () => {
    const fake = gatewayFor(null);
    const store = new SessionStore(fake.gateway);
    await store.refresh(session("missing-profile"));

    const rejection = await captureRejection(
      beforeLoad("/retailer")({
        context: { session: store },
        location: { pathname: "/retailer", searchStr: "" },
      }),
    );

    expect(fake.signOutCalls()).toBe(1);
    expect(store.getSnapshot().state.status).toBe("signed-out");
    expect(rejection).toMatchObject({ options: { href: "/" } });
  });

  it("bypasses session loading for root payment returns and public checkout results", async () => {
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: { getItem: () => null },
    });
    let ensureReadyCalls = 0;
    const store = {
      ensureReady: () => {
        ensureReadyCalls += 1;
        throw new Error("Payment routes must not load auth state");
      },
    } as unknown as SessionStore;

    try {
      await beforeLoad("/")({
        context: { session: store },
        location: { pathname: "/", searchStr: "?status=VALID&tran_id=t&val_id=v" },
      });
      await beforeLoad("/retailer/checkout/success")({
        context: { session: store },
        location: { pathname: "/retailer/checkout/success", searchStr: "" },
      });
      expect(ensureReadyCalls).toBe(0);
    } finally {
      if (storageDescriptor) {
        Object.defineProperty(globalThis, "sessionStorage", storageDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "sessionStorage");
      }
    }
  });
});

describe("root payment precedence", () => {
  it.each([
    ["truthy status", "/", "?status=VALID&tran_id=t&val_id=v", null, true],
    ["empty status", "/", "?status=&tran_id=t&val_id=v", null, false],
    ["payment return flag", "/", "", "1", true],
    ["transaction alone", "/", "?tran_id=t", null, false],
    ["non-root status", "/retailer", "?status=VALID", "1", false],
    ["ordinary auth", "/", "", null, false],
  ])("handles %s", (_name, pathname, search, paymentReturn, expected) => {
    expect(shouldRenderPaymentResult({ pathname, search, paymentReturn })).toBe(expected);
  });
});
