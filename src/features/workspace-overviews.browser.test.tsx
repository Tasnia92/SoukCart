import "../tailwind.css";
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
import { buildAdminDashboard, type AdminDashboard } from "./admin/admin-dashboard-api.ts";
import type { ActivityOrder } from "./admin/admin-activity-api.ts";
import type { AdminComplaint } from "./admin/admin-complaints-api.ts";
import type { AdminOverviewUser } from "./admin/admin-overview-api.ts";
import { AdminInbox } from "./admin/AdminInbox.tsx";
import { AdminOverview } from "./admin/AdminOverview.tsx";
import type { RetailerComplaint } from "./retailer/retailer-complaints-api.ts";
import type { RetailerOrder } from "./retailer/retailer-orders-api.ts";
import { RetailerOverview } from "./retailer/RetailerOverview.tsx";
import {
  buildSupplierDashboard,
  type SupplierDashboard,
} from "./supplier/supplier-dashboard-api.ts";
import type { SupplierOrder } from "./supplier/supplier-orders-api.ts";
import type { SupplierProduct } from "./supplier/supplier-overview-api.ts";
import { SupplierOverview } from "./supplier/SupplierOverview.tsx";
import { SessionProvider, SessionStore, type Profile, type SessionGateway } from "../session.tsx";

const inBrowser = typeof document !== "undefined";
if (inBrowser) {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
}

const NOW = Date.parse("2026-09-02T12:00:00.000Z");
const DAY = 86_400_000;

function iso(offsetDays: number): string {
  return new Date(NOW - offsetDays * DAY).toISOString();
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

function createOverviewRouter(path: string, content: ReactNode) {
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

async function openWorkspaceMenu(host: ParentNode) {
  const { userEvent } = await import("vite-plus/test/browser/context");
  const account =
    host.querySelector('[aria-label="Account menu"]') ??
    document.querySelector('[aria-label="Account menu"]');
  if (account) return;
  const trigger =
    host.querySelector<HTMLButtonElement>("[data-sidebar=trigger]") ??
    document.querySelector<HTMLButtonElement>("[data-sidebar=trigger]");
  if (!trigger) throw new Error("Expected a sidebar trigger");
  await act(async () => userEvent.click(trigger));
  await flush();
}

async function openInboxMenu() {
  const { userEvent } = await import("vite-plus/test/browser/context");
  await openWorkspaceMenu(document);
  const trigger =
    document.querySelector<HTMLButtonElement>('[aria-label="Inbox"]') ??
    [...document.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Inbox"),
    );
  if (!trigger) throw new Error("Expected an Inbox sidebar control");
  await act(async () => userEvent.click(trigger));
  await flush();
}

async function clickLogOut(host: ParentNode) {
  const { userEvent } = await import("vite-plus/test/browser/context");
  await openWorkspaceMenu(host);
  const trigger =
    host.querySelector<HTMLButtonElement>('[aria-label="Account menu"]') ??
    document.querySelector<HTMLButtonElement>('[aria-label="Account menu"]');
  if (!trigger) throw new Error("Expected an Account menu trigger");
  await act(async () => userEvent.click(trigger));
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === "Log out",
  );
  if (!item) throw new Error("Expected a Log out menu item");
  await act(async () => userEvent.click(item as HTMLElement));
}

/** Reads a metric card by its label so assertions do not depend on card order. */
function metric(host: ParentNode, label: string): HTMLElement {
  const match = [...host.querySelectorAll<HTMLElement>(".db-metric")].find(
    (card) => card.querySelector(".db-metric-label")?.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Expected a metric card labelled ${label}`);
  return match;
}

function metricValue(host: ParentNode, label: string): string {
  return metric(host, label).querySelector(".db-metric-value")?.textContent?.trim() ?? "";
}

/** Charts also render a data table, so tables are addressed by their caption. */
function tableByCaption(host: ParentNode, caption: string): HTMLTableElement {
  const match = [...host.querySelectorAll<HTMLTableElement>(".db-table")].find(
    (table) => table.querySelector("caption")?.textContent?.trim() === caption,
  );
  if (!match) throw new Error(`Expected a table captioned ${caption}`);
  return match;
}

/* -----------------------------------------------------------------------------
 * Fixtures
 * -------------------------------------------------------------------------- */

const adminUsers: AdminOverviewUser[] = [
  {
    id: "active",
    email: "active@example.com",
    name: "Active",
    role: "admin",
    created_at: iso(3),
    last_sign_in_at: iso(1),
    email_confirmed_at: iso(3),
  },
  {
    id: "needs-setup",
    email: "setup@example.com",
    name: "Setup",
    role: null,
    created_at: iso(60),
    last_sign_in_at: null,
    email_confirmed_at: iso(60),
  },
];

const adminOrders: ActivityOrder[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    status: "pending",
    cancel_requested: false,
    cancellation_initiator: null,
    cancellation_reason: null,
    payment_status: "paid",
    payment_method: "online",
    created_at: iso(1),
    delivered_at: null,
    delivery_verified_at: null,
    delivery_phone: "01700000000",
    delivery_address: "12 Road",
    delivery_city: "Dhaka",
    delivery_postcode: "1205",
    platform_charge: 0,
    delivery_charge: 0,
    refund_amount: 0,
    manual_refund_status: "not_required",
    refund_completed_at: null,
    retailer_id: "retailer-1",
    retailer_name: "Rani Retail",
    retailer_email: "rani@example.com",
    total: 400,
    lines: [
      {
        id: "line-1",
        product_id: "product-1",
        product_name: "Atlas dates",
        quantity: 4,
        unit_price: 100,
        amount: 400,
        supplier_id: "seller-1",
        supplier_name: "Samira Supplier",
        supplier_email: "samira@example.com",
      },
    ],
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    status: "confirmed",
    cancel_requested: true,
    cancellation_initiator: "retailer",
    cancellation_reason: "Ordered twice",
    payment_status: "paid",
    payment_method: "online",
    created_at: iso(2),
    delivered_at: null,
    delivery_verified_at: null,
    delivery_phone: "01700000000",
    delivery_address: "12 Road",
    delivery_city: "Dhaka",
    delivery_postcode: "1205",
    platform_charge: 0,
    delivery_charge: 0,
    refund_amount: 150,
    manual_refund_status: "review_required",
    refund_completed_at: null,
    retailer_id: "retailer-2",
    retailer_name: "Bashir Bazaar",
    retailer_email: "bashir@example.com",
    total: 150,
    lines: [],
  },
];

const adminComplaints: AdminComplaint[] = [
  {
    id: "complaint-1",
    order_id: null,
    category: "general",
    subject: "Damaged crate",
    description: "Two crates arrived crushed.",
    attachment_url: null,
    status: "open",
    created_at: iso(1),
    retailer_id: "retailer-1",
    retailer_name: "Rani Retail",
    retailer_email: "rani@example.com",
  },
];

function adminDashboard(): AdminDashboard {
  return buildAdminDashboard(
    {
      orders: adminOrders,
      users: adminUsers,
      complaints: adminComplaints,
    },
    NOW,
  );
}

const supplierProducts: SupplierProduct[] = [
  {
    id: "product-1",
    name: "Atlas dates",
    description: "Sweet dates",
    price: 240,
    unit: "kg",
    stock: 9,
    min_order_qty: 1,
    category: "Groceries",
    image_url: null,
    is_active: true,
    created_at: iso(1),
  },
  {
    id: "product-2",
    name: "Olive oil",
    description: "Cold pressed",
    price: 650,
    unit: "bottle",
    stock: 0,
    min_order_qty: 1,
    category: "Pantry",
    image_url: "https://example.test/olive-oil.jpg",
    is_active: true,
    created_at: iso(2),
  },
  {
    id: "product-3",
    name: "Hidden spices",
    description: "Cumin",
    price: 130,
    unit: "jar",
    stock: 7,
    min_order_qty: 1,
    category: "Pantry",
    image_url: null,
    is_active: false,
    created_at: iso(3),
  },
  {
    id: "product-4",
    name: "Mint tea",
    description: "Loose leaf",
    price: 180,
    unit: "box",
    stock: 4,
    min_order_qty: 1,
    category: "Tea",
    image_url: null,
    is_active: true,
    created_at: iso(4),
  },
];

const supplierOrders: SupplierOrder[] = [
  {
    id: "33333333-3333-3333-3333-333333333333",
    status: "pending",
    cancel_requested: false,
    cancellation_initiator: null,
    cancellation_reason: null,
    payment_status: "paid",
    payment_method: "online",
    delivery_verified_at: null,
    delivery_phone: "01700000000",
    delivery_address: "12 Road",
    delivery_city: "Dhaka",
    delivery_postcode: "1205",
    manual_refund_status: "not_required",
    supplier_can_cancel: true,
    notes: null,
    created_at: iso(2),
    retailer_name: "Rani Retail",
    retailer_email: "rani@example.com",
    accepted_at: null,
    items: [
      {
        id: "item-1",
        product_id: "product-1",
        product_name: "Atlas dates",
        quantity: 5,
        unit_price: 240,
        line_total: 1200,
      },
    ],
    supplier_total: 1200,
  },
];

function supplierDashboard(): SupplierDashboard {
  return buildSupplierDashboard(supplierOrders, supplierProducts, NOW);
}

function retailerOrder(overrides: Partial<RetailerOrder>): RetailerOrder {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    status: "shipped",
    cancel_requested: false,
    cancellation_initiator: null,
    payment_status: "paid",
    payment_method: "online",
    tran_id: null,
    notes: null,
    created_at: iso(2),
    delivery_verified_at: null,
    delivery_phone: "01700000000",
    delivery_address: "12 Road",
    delivery_city: "Dhaka",
    delivery_postcode: "1205",
    manual_refund_status: "not_required",
    refund_amount: 0,
    platform_charge: 0,
    delivery_charge: 0,
    items: [
      {
        id: "item-1",
        product_id: "product-1",
        quantity: 3,
        unit_price: 100,
        product_name: "Atlas dates",
      },
    ],
    ...overrides,
  };
}

const retailerComplaints: RetailerComplaint[] = [
  {
    id: "complaint-1",
    order_id: null,
    category: "general",
    subject: "Missing unit",
    description: "One box short.",
    attachment_url: null,
    status: "open",
    created_at: iso(4),
  },
];

/* -----------------------------------------------------------------------------
 * Tests
 * -------------------------------------------------------------------------- */

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
      let resolveRefresh: ((dashboard: AdminDashboard) => void) | undefined;
      const loadDashboard = () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("Admin service unavailable."));
        if (calls === 2) return Promise.resolve(adminDashboard());
        return new Promise<AdminDashboard>((resolve) => {
          resolveRefresh = resolve;
        });
      };
      const router = createOverviewRouter(
        "/admin",
        <SessionProvider store={admin.store}>
          <AdminOverview loadDashboard={loadDashboard} />
        </SessionProvider>,
      );
      const mounted = await mount(<RouterProvider router={router} />);

      try {
        await flush();
        expect(mounted.host.textContent).toContain("We could not load the admin workspace.");
        expect(mounted.host.textContent).toContain("Admin service unavailable.");

        await act(async () => userEvent.click(button(mounted.host, "Try again")));
        await flush();
        expect(mounted.host.textContent).toContain("Command center.");

        const refresh = button(mounted.host, "Refresh");
        await act(async () => userEvent.click(refresh));
        expect(refresh.disabled).toBe(true);
        // Stale data stays visible while the refresh is in flight.
        expect(mounted.host.textContent).toContain("Command center.");
        if (!resolveRefresh) throw new Error("Expected refresh loader to be pending");
        await act(async () => resolveRefresh?.(adminDashboard()));
        expect(refresh.disabled).toBe(false);

        await openWorkspaceMenu(mounted.host);
        expect(document.body.textContent).toContain("Avery Administrator");
        expect(document.body.textContent).toContain("avery.long.admin@example.com");

        const overview = element<HTMLAnchorElement>(
          document,
          'nav[aria-label="Admin navigation"] a[aria-current="page"]',
        );
        expect(overview.textContent).toContain("Overview");
        expect(overview.getAttribute("href")).toBe("/admin");

        await clickLogOut(mounted.host);
        await flush();
        expect(admin.signOutCalls()).toBe(1);
        expect(mounted.host.textContent).toBe("");
      } finally {
        await unmount(mounted.root);
      }
    },
  );

  it.runIf(inBrowser)(
    "answers what changed, what is blocked, and what is next on the admin overview",
    async () => {
      const admin = createSessionStore({
        id: "admin-1",
        email: "admin@example.com",
        name: "Avery Administrator",
        role: "admin",
      });
      await admin.ready();

      const router = createOverviewRouter(
        "/admin",
        <SessionProvider store={admin.store}>
          <AdminOverview loadDashboard={() => Promise.resolve(adminDashboard())} />
        </SessionProvider>,
      );
      const mounted = await mount(<RouterProvider router={router} />);

      try {
        await flush();

        // What changed: GMV order value for a stated period, with a comparison.
        expect(metricValue(mounted.host, "Order value")).toBe("৳550.00");
        expect(metric(mounted.host, "Order value").textContent).toContain("Last 30 days");
        expect(metric(mounted.host, "Order value").textContent).toContain("Paid");
        // What needs attention, with selectable subcounts.
        expect(metricValue(mounted.host, "Orders awaiting action")).toBe("2");
        expect(metric(mounted.host, "Orders awaiting action").textContent).toContain(
          "Awaiting confirmation",
        );
        expect(metric(mounted.host, "Orders awaiting action").textContent).toContain(
          "Cancellation requests",
        );
        expect(metric(mounted.host, "Orders awaiting action").textContent).toContain("Refunds due");
        expect(metricValue(mounted.host, "Open disputes")).toBe("1");
        expect(metricValue(mounted.host, "Accounts needing setup")).toBe("1");

        // Urgent SLA work and the action queue are Inbox pages, not dashboard sections.
        expect(mounted.host.querySelector(".db-queue")).toBeNull();
        expect(mounted.host.querySelector(".db-inbox")).toBeNull();

        await openInboxMenu();
        expect(
          element<HTMLAnchorElement>(document, 'a[href="/admin/inbox/urgent"]').textContent,
        ).toContain("Urgent work");
        expect(
          element<HTMLAnchorElement>(document, 'a[href="/admin/inbox/queue"]').textContent,
        ).toContain("Action queue");
        const { userEvent } = await import("vite-plus/test/browser/context");
        await act(async () => userEvent.keyboard("{Escape}"));
        await flush();

        // Every chart carries a text equivalent (the data table), even if the
        // SVG needs a real layout width to paint.
        const chart = element(mounted.host, ".db-chart");
        expect(element(chart, ".db-chart-summary").textContent).toContain("৳550.00");
        expect(element(chart, "details table tbody").children).toHaveLength(30);

        // Recent orders reach the full ledger.
        const table = tableByCaption(mounted.host, "Recent marketplace orders");
        expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
        expect(table.textContent).toContain("Rani Retail");
        expect(element<HTMLAnchorElement>(mounted.host, 'a[href="/admin/activity"]')).toBeTruthy();
        expect(
          element<HTMLAnchorElement>(mounted.host, 'a[href="/admin/complaints"]'),
        ).toBeTruthy();
        expect(element<HTMLAnchorElement>(mounted.host, 'a[href="/admin/users"]')).toBeTruthy();

        expect(mounted.host.textContent).toContain("Up to date");
        await clickLogOut(mounted.host);
      } finally {
        await unmount(mounted.root);
      }
    },
  );

  it.runIf(inBrowser)("lists inbox work on a full page instead of a sidebar overlay", async () => {
    const admin = createSessionStore({
      id: "admin-1",
      email: "admin@example.com",
      name: "Avery Administrator",
      role: "admin",
    });
    await admin.ready();

    const router = createOverviewRouter(
      "/admin/inbox/queue",
      <SessionProvider store={admin.store}>
        <AdminInbox view="queue" loadDashboard={() => Promise.resolve(adminDashboard())} />
      </SessionProvider>,
    );
    const mounted = await mount(<RouterProvider router={router} />);

    try {
      await flush();
      expect(mounted.host.textContent).toContain("Action queue.");
      expect(mounted.host.querySelector('[data-slot="sheet-content"]')).toBeNull();

      const queue = element(mounted.host, ".db-queue");
      expect(queue.querySelectorAll("tbody tr").length).toBeGreaterThanOrEqual(3);
      expect(queue.textContent).toContain("Refund needs review");
      expect(queue.textContent).toContain("৳150.00");
      expect(queue.textContent).toContain("Cancellation requested by retailer");
      expect(queue.textContent).toContain("Damaged crate");
      expect(queue.textContent).toContain("awaiting confirmation");
    } finally {
      await unmount(mounted.root);
    }
  });

  it.runIf(inBrowser)("leads the supplier overview with fulfillment and stock risk", async () => {
    const seller = createSessionStore({
      id: "seller-1",
      email: "samira.supplier@example.com",
      name: "Samira Supplier",
      role: "seller",
    });
    await seller.ready();
    sessionStorage.setItem("soukcart:supplier-notice", "Product saved.");

    let requestedSellerId = "";
    let resolveDashboard: ((dashboard: SupplierDashboard) => void) | undefined;
    const loadDashboard = (sellerId: string) => {
      requestedSellerId = sellerId;
      return new Promise<SupplierDashboard>((resolve) => {
        resolveDashboard = resolve;
      });
    };
    const router = createOverviewRouter(
      "/supplier",
      <SessionProvider store={seller.store}>
        <SupplierOverview loadDashboard={loadDashboard} />
      </SessionProvider>,
    );
    const mounted = await mount(<RouterProvider router={router} />);

    try {
      expect(mounted.host.textContent).toContain("Loading your workspace…");
      expect(element(mounted.host, ".db-skeleton")).toBeTruthy();
      expect(requestedSellerId).toBe("seller-1");
      if (!resolveDashboard) throw new Error("Expected supplier loader to be pending");
      await act(async () => resolveDashboard?.(supplierDashboard()));

      expect(mounted.host.textContent).toContain("Good to see you, Samira.");
      expect(mounted.host.textContent).toContain("Product saved.");
      expect(sessionStorage.getItem("soukcart:supplier-notice")).toBeNull();

      expect(metricValue(mounted.host, "Sales")).toBe("৳1,200.00");
      expect(metricValue(mounted.host, "Awaiting fulfillment")).toBe("1");
      // Olive oil is out of stock and Mint tea is at 4 units; the hidden jar is not a risk.
      expect(metricValue(mounted.host, "Stock at risk")).toBe("2");
      expect(metricValue(mounted.host, "Active listings")).toBe("3");

      // Stock health names the items and offers the restock action.
      const health = element(mounted.host, ".db-health");
      expect(health.textContent).toContain("Olive oil");
      expect(health.textContent).toContain("Mint tea");
      expect(health.textContent).not.toContain("Hidden spices");
      const healthBars = [...health.querySelectorAll(".db-health-bar")];
      expect(
        healthBars.some((bar) =>
          bar.getAttribute("aria-label")?.toLowerCase().includes("out of stock"),
        ),
      ).toBe(true);

      // The fulfillment queue is a table with a per-row action.
      expect(mounted.host.textContent).toContain("Fulfillment queue");
      expect(mounted.host.textContent).toContain("Process order");
      expect(mounted.host.textContent).toContain("Rani Retail");

      // Top products rank by value sold.
      const bars = element(mounted.host, ".db-bars");
      expect(bars.children).toHaveLength(1);
      expect(bars.textContent).toContain("Atlas dates");
      expect(bars.textContent).toContain("5 units sold");

      await openWorkspaceMenu(mounted.host);
      const overview = element<HTMLAnchorElement>(
        document,
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
      expect(
        element<HTMLImageElement>(mounted.host, 'img[src="https://example.test/olive-oil.jpg"]'),
      ).toHaveProperty("loading", "lazy");

      await clickLogOut(mounted.host);
      await flush();
      expect(seller.signOutCalls()).toBe(1);
      expect(router.state.location.pathname).toBe("/");
      expect(mounted.host.textContent).toBe("Signed out home");
    } finally {
      sessionStorage.removeItem("soukcart:supplier-notice");
      await unmount(mounted.root);
    }
  });

  it.runIf(inBrowser)(
    "leads the retailer overview with one next action and reconciles payments after paint",
    async () => {
      const retailer = createSessionStore({
        id: "retailer-1",
        email: "rani@example.com",
        name: "Rani Retail",
        role: "retailer",
      });
      await retailer.ready();

      const orders = [
        retailerOrder({ id: "shipped-order", status: "shipped" }),
        retailerOrder({
          id: "unpaid-order",
          status: "pending",
          payment_status: "unpaid",
          tran_id: "tran-1",
          created_at: iso(1),
        }),
      ];

      let reconciled = 0;
      let resolveReconcile:
        | ((result: {
            updates: { id: string; payment_status: RetailerOrder["payment_status"] }[];
            cartCleared: boolean;
          }) => void)
        | undefined;

      const router = createOverviewRouter(
        "/retailer",
        <SessionProvider store={retailer.store}>
          <RetailerOverview
            loadInput={async () => ({
              orders,
              cartUnits: 3,
              complaints: retailerComplaints,
              failures: [],
            })}
            reconcile={() => {
              reconciled += 1;
              return new Promise((resolve) => {
                resolveReconcile = resolve;
              });
            }}
          />
        </SessionProvider>,
      );
      const mounted = await mount(<RouterProvider router={router} />);

      try {
        await flush();

        // The dashboard paints before the payment gateway answers.
        expect(reconciled).toBe(1);
        const next = element(mounted.host, ".db-next");
        expect(next.textContent).toContain("Check out 3 items in your cart");
        expect(element<HTMLAnchorElement>(next, "a").getAttribute("href")).toBe("/retailer/cart");

        expect(metricValue(mounted.host, "Spend")).toBe("৳600.00");
        expect(metricValue(mounted.host, "Active orders")).toBe("2");
        expect(metricValue(mounted.host, "In your cart")).toBe("3");
        await openWorkspaceMenu(mounted.host);
        expect(
          (
            mounted.host.querySelector(".rt-nav-badge") ?? document.querySelector(".rt-nav-badge")
          )?.textContent?.trim(),
        ).toBe("3");

        // Fulfillment ladder and help tickets both link to their full workflow.
        expect(element(mounted.host, ".db-stages").children).toHaveLength(5);
        expect(mounted.host.textContent).toContain("Help Center tickets");
        expect(
          element<HTMLAnchorElement>(mounted.host, 'a[href="/retailer/complaints"]'),
        ).toBeTruthy();

        // Once reconciliation settles as paid, the cart empties and the next action moves on.
        if (!resolveReconcile) throw new Error("Expected reconciliation to be pending");
        await act(async () =>
          resolveReconcile?.({
            updates: [{ id: "unpaid-order", payment_status: "paid" }],
            cartCleared: true,
          }),
        );
        await flush();

        expect(metricValue(mounted.host, "In your cart")).toBe("0");
        expect(element(mounted.host, ".db-next").textContent).toContain(
          "Track your nearest delivery",
        );
      } finally {
        await unmount(mounted.root);
      }
    },
  );
});
