import "../tailwind.css";
import "../theme.css";
import "../style.css";
import type { Session } from "@supabase/supabase-js";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import { AdminOverview } from "./admin/AdminOverview.tsx";
import type { AdminOverviewUser } from "./admin/admin-overview-api.ts";
import { SupplierOverview } from "./supplier/SupplierOverview.tsx";
import type { SupplierProduct } from "./supplier/supplier-overview-api.ts";
import { SessionProvider, SessionStore, type Profile, type SessionGateway } from "../session.tsx";

const inBrowser = typeof document !== "undefined";
if (inBrowser) {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
}

function session(id: string): Session {
  return { user: { id } } as Session;
}

function createSessionStore(profile: Profile) {
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
  const store = new SessionStore(gateway);

  return {
    signOutCalls: () => signOutCalls,
    store,
    ready: () => store.refresh(session(profile.id)),
  };
}

function createOverviewRouter(path: "/admin" | "/supplier", content: ReactNode) {
  const rootRoute = createRootRoute({ component: Outlet });
  const signedOutRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <p>Signed out home</p>,
  });
  const overviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => content,
  });

  return createRouter({
    routeTree: rootRoute.addChildren([signedOutRoute, overviewRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
}

async function mount(node: ReactNode): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function unmount(root: Root): Promise<void> {
  await act(async () => root.unmount());
  document.body.replaceChildren();
}

function element<T extends Element>(host: ParentNode, selector: string): T {
  const match = host.querySelector<T>(selector);
  if (!match) throw new Error(`Expected an element matching ${selector}`);
  return match;
}

function button(host: ParentNode, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Expected a button named ${label}`);
  return match;
}

const adminUsers: AdminOverviewUser[] = [
  {
    id: "active",
    email: "active@example.com",
    name: "Active",
    role: "admin",
    created_at: "2026-08-30T12:00:00.000Z",
    last_sign_in_at: "2026-08-31T12:00:00.000Z",
    email_confirmed_at: "2026-08-30T12:00:00.000Z",
  },
  {
    id: "needs-setup",
    email: "setup@example.com",
    name: "Setup",
    role: null,
    created_at: "2026-07-01T12:00:00.000Z",
    last_sign_in_at: null,
    email_confirmed_at: "2026-07-01T12:00:00.000Z",
  },
];

const supplierProducts: SupplierProduct[] = [
  {
    id: "product-1",
    name: "Atlas dates",
    description: "Sweet dates",
    price: 240,
    unit: "kg",
    stock: 9,
    category: "Groceries",
    image_url: null,
    is_active: true,
    created_at: "2026-09-01T10:00:00.000Z",
  },
  {
    id: "product-2",
    name: "Olive oil",
    description: "Cold pressed",
    price: 650,
    unit: "bottle",
    stock: 0,
    category: "Pantry",
    image_url: "https://example.test/olive-oil.jpg",
    is_active: true,
    created_at: "2026-08-31T10:00:00.000Z",
  },
  {
    id: "product-3",
    name: "Hidden spices",
    description: "Cumin",
    price: 130,
    unit: "jar",
    stock: 7,
    category: "Pantry",
    image_url: null,
    is_active: false,
    created_at: "2026-08-30T10:00:00.000Z",
  },
  {
    id: "product-4",
    name: "Mint tea",
    description: "Loose leaf",
    price: 180,
    unit: "box",
    stock: 4,
    category: "Tea",
    image_url: null,
    is_active: true,
    created_at: "2026-08-29T10:00:00.000Z",
  },
  {
    id: "product-5",
    name: "Not recent",
    description: "Fifth listing",
    price: 150,
    unit: "pack",
    stock: 3,
    category: "Pantry",
    image_url: null,
    is_active: true,
    created_at: "2026-08-28T10:00:00.000Z",
  },
];

describe("React workspace overview behavior", () => {
  it.runIf(inBrowser)(
    "preserves the admin error, retry, refresh, shell, and logout states",
    async () => {
      const { userEvent } = await import("vite-plus/test/browser/context");
      const admin = createSessionStore({
        id: "admin-1",
        email: "avery.long.admin@example.com",
        name: "Avery Administrator",
        role: "admin",
      });
      await admin.ready();

      let calls = 0;
      let resolveRefresh: ((users: AdminOverviewUser[]) => void) | undefined;
      const loadUsers = () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("Admin service unavailable."));
        if (calls === 2) return Promise.resolve(adminUsers);
        return new Promise<AdminOverviewUser[]>((resolve) => {
          resolveRefresh = resolve;
        });
      };
      const router = createOverviewRouter(
        "/admin",
        <SessionProvider store={admin.store}>
          <AdminOverview loadUsers={loadUsers} />
        </SessionProvider>,
      );
      const mounted = await mount(<RouterProvider router={router} />);

      try {
        await flush();
        expect(mounted.host.textContent).toContain("We could not load the admin workspace.");
        expect(mounted.host.textContent).toContain("Admin service unavailable.");

        await act(async () => userEvent.click(button(mounted.host, "Try again")));
        await flush();
        expect(mounted.host.textContent).toContain("Everything in sync.");
        expect(mounted.host.textContent).toContain("Avery Administrator");
        expect(mounted.host.textContent).toContain("avery.long.admin@example.com");
        expect(mounted.host.textContent).toContain("Total accounts2");
        expect(mounted.host.textContent).toContain("Needs setup1");

        const overview = element<HTMLAnchorElement>(
          mounted.host,
          'nav[aria-label="Admin navigation"] a[aria-current="page"]',
        );
        expect(overview.textContent).toContain("Overview");
        expect(overview.getAttribute("href")).toBe("/admin");

        const refresh = button(mounted.host, "Refresh");
        await act(async () => userEvent.click(refresh));
        expect(refresh.disabled).toBe(true);
        expect(mounted.host.textContent).toContain("Total accounts2");
        if (!resolveRefresh) throw new Error("Expected refresh loader to be pending");
        await act(async () => resolveRefresh?.(adminUsers));
        expect(refresh.disabled).toBe(false);

        await act(async () => userEvent.click(button(mounted.host, "Log out")));
        await flush();
        expect(admin.signOutCalls()).toBe(1);
        expect(mounted.host.textContent).toBe("");
      } finally {
        await unmount(mounted.root);
      }
    },
  );

  it.runIf(inBrowser)(
    "preserves seller-only loading, flash, listings, shell links, and logout",
    async () => {
      const { userEvent } = await import("vite-plus/test/browser/context");
      const seller = createSessionStore({
        id: "seller-1",
        email: "samira.supplier@example.com",
        name: "Samira Supplier",
        role: "seller",
      });
      await seller.ready();
      sessionStorage.setItem("soukcart:supplier-notice", "Product saved.");

      let requestedSellerId = "";
      let resolveProducts: ((products: SupplierProduct[]) => void) | undefined;
      const loadProducts = (sellerId: string) => {
        requestedSellerId = sellerId;
        return new Promise<SupplierProduct[]>((resolve) => {
          resolveProducts = resolve;
        });
      };
      const router = createOverviewRouter(
        "/supplier",
        <SessionProvider store={seller.store}>
          <SupplierOverview loadProducts={loadProducts} />
        </SessionProvider>,
      );
      const mounted = await mount(<RouterProvider router={router} />);

      try {
        expect(mounted.host.textContent).toContain("Loading your catalog…");
        expect(requestedSellerId).toBe("seller-1");
        if (!resolveProducts) throw new Error("Expected supplier loader to be pending");
        await act(async () => resolveProducts?.(supplierProducts));

        expect(mounted.host.textContent).toContain("Good to see you, Samira.");
        expect(mounted.host.textContent).toContain("Product saved.");
        expect(sessionStorage.getItem("soukcart:supplier-notice")).toBeNull();
        expect(mounted.host.textContent).toContain("Total products5");
        expect(mounted.host.textContent).toContain("Active listings4");
        expect(mounted.host.textContent).toContain("Out of stock1");
        expect(mounted.host.textContent).toContain("Units in stock23");
        expect(mounted.host.textContent).toContain("Atlas dates");
        expect(mounted.host.textContent).toContain("Mint tea");
        expect(mounted.host.textContent).not.toContain("Not recent");
        expect(
          element<HTMLImageElement>(mounted.host, 'img[src="https://example.test/olive-oil.jpg"]'),
        ).toHaveProperty("loading", "lazy");

        const overview = element<HTMLAnchorElement>(
          mounted.host,
          'nav[aria-label="Supplier navigation"] a[aria-current="page"]',
        );
        expect(overview.getAttribute("href")).toBe("/supplier");
        expect(
          element<HTMLAnchorElement>(mounted.host, 'a[href="/supplier/products/new"]'),
        ).toBeTruthy();
        expect(element<HTMLAnchorElement>(mounted.host, 'a[href="/supplier/stock"]')).toBeTruthy();
        expect(
          element<HTMLAnchorElement>(mounted.host, 'a[href="/supplier/products/product-1/edit"]'),
        ).toBeTruthy();

        await act(async () => userEvent.click(button(mounted.host, "Log out")));
        await flush();
        expect(seller.signOutCalls()).toBe(1);
        expect(router.state.location.pathname).toBe("/");
        expect(mounted.host.textContent).toBe("Signed out home");
      } finally {
        sessionStorage.removeItem("soukcart:supplier-notice");
        await unmount(mounted.root);
      }
    },
  );
});
