import "../../tailwind.css";
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
import {
  SessionProvider,
  SessionStore,
  type Profile,
  type SessionGateway,
} from "../../session.tsx";
import { AdminSupplierVerificationDetail } from "./AdminSupplierVerificationDetail.tsx";
import { AdminSupplierVerifications } from "./AdminSupplierVerifications.tsx";
import type { AdminSupplierVerification } from "./admin-supplier-verifications-api.ts";

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
  const gateway: SessionGateway = {
    getSession: async () => ({ session: null, error: null }),
    getProfile: async () => ({ profile, error: null }),
    subscribe: () => () => undefined,
    signIn: async () => ({ error: null }),
    signUp: async () => ({ error: null }),
    signOut: async () => ({ error: null }),
    updateRole: async () => ({ error: null }),
  };
  const store = new SessionStore(gateway);
  return {
    store,
    ready: () => store.refresh(session(profile.id)),
  };
}

function createPageRouter(initialPath: string, content: ReactNode) {
  const rootRoute = createRootRoute({ component: Outlet });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/verifications",
    component: () => content,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/verifications/$userId",
    component: () => content,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([listRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
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

const verification: AdminSupplierVerification = {
  user_id: "seller-1",
  shop_name: "Rahman Traders",
  shop_details: "Wholesale rice and pulses.",
  location: "Karwan Bazar, Dhaka",
  trade_license_number: "TRAD/DNCC/1234/2024",
  contact_phone: "01712345678",
  status: "pending",
  review_note: null,
  reviewed_at: null,
  created_at: "2026-09-01T09:00:00.000Z",
  updated_at: "2026-09-01T09:00:00.000Z",
  supplier_name: "Abdur Rahman",
  supplier_email: "rahman@example.com",
  nid_front_url: "https://signed.example/nid-front.jpg",
  nid_back_url: "https://signed.example/nid-back.jpg",
};

const adminProfile: Profile = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Avery Administrator",
  role: "admin",
};

describe("admin supplier verification screens", () => {
  it.runIf(inBrowser)(
    "lists identity, contact, and a copy control for the trade licence number",
    async () => {
      const admin = createSessionStore(adminProfile);
      await admin.ready();
      const { userEvent } = await import("vite-plus/test/browser/context");

      let copied = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            copied = text;
          },
        },
      });

      const router = createPageRouter(
        "/admin/verifications",
        <SessionProvider store={admin.store}>
          <AdminSupplierVerifications loadVerifications={async () => [verification]} />
        </SessionProvider>,
      );
      const mounted = await mount(<RouterProvider router={router} />);

      try {
        await flush();
        expect(mounted.host.textContent).toContain("Rahman Traders");
        expect(mounted.host.textContent).toContain("Abdur Rahman");
        expect(element<HTMLInputElement>(mounted.host, "#trade-license-seller-1").value).toBe(
          "TRAD/DNCC/1234/2024",
        );
        expect(mounted.host.textContent).toContain("01712345678");
        expect(mounted.host.textContent).toContain("Karwan Bazar, Dhaka");
        expect(mounted.host.textContent).toContain(
          "trade licence number, NID card, and contact info",
        );
        expect(
          element<HTMLImageElement>(mounted.host, 'img[alt="Rahman Traders NID card front"]'),
        ).toBeTruthy();

        const copy = element<HTMLButtonElement>(
          mounted.host,
          '[aria-label="Copy trade licence number"]',
        );
        await act(async () => userEvent.click(copy));
        await flush();
        expect(copied).toBe("TRAD/DNCC/1234/2024");
        expect(element(mounted.host, '[aria-label="Copied"]')).toBeTruthy();
      } finally {
        await unmount(mounted.root);
      }
    },
  );

  it.runIf(inBrowser)(
    "reviews NID photos, contact, and copies the trade licence number on the detail page",
    async () => {
      const admin = createSessionStore(adminProfile);
      await admin.ready();
      const { userEvent } = await import("vite-plus/test/browser/context");

      let copied = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            copied = text;
          },
        },
      });

      const router = createPageRouter(
        "/admin/verifications/seller-1",
        <SessionProvider store={admin.store}>
          <AdminSupplierVerificationDetail
            userId="seller-1"
            loadVerifications={async () => [verification]}
          />
        </SessionProvider>,
      );
      const mounted = await mount(<RouterProvider router={router} />);

      try {
        await flush();
        expect(mounted.host.textContent).toContain("NID card front");
        expect(mounted.host.textContent).toContain("NID card back");
        expect(mounted.host.textContent).toContain("Identity and contact");
        expect(element<HTMLInputElement>(mounted.host, "#trade-license-number").value).toBe(
          "TRAD/DNCC/1234/2024",
        );
        expect(mounted.host.textContent).toContain("01712345678");
        expect(mounted.host.textContent).toContain("rahman@example.com");
        expect(mounted.host.textContent).toContain(
          "Copy this number, then open the government site to verify the e-trade licence.",
        );
        const verify = element<HTMLAnchorElement>(
          mounted.host,
          'a[href="https://www.etradelicense.gov.bd/ULicVerifyEng"]',
        );
        expect(verify.textContent).toContain("Verify e-trade number");
        expect(verify.target).toBe("_blank");
        expect(mounted.host.textContent).not.toContain("trade licence scan");
        expect(mounted.host.textContent).not.toContain("Trade licence file");

        const copy = element<HTMLButtonElement>(
          mounted.host,
          '[aria-label="Copy trade licence number"]',
        );
        await act(async () => userEvent.click(copy));
        await flush();
        expect(copied).toBe("TRAD/DNCC/1234/2024");
      } finally {
        await unmount(mounted.root);
      }
    },
  );
});

function element<T extends Element>(host: ParentNode, selector: string): T {
  const match = host.querySelector<T>(selector);
  if (!match) throw new Error(`Expected an element matching ${selector}`);
  return match;
}
