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
import { SupplierProductForm } from "./SupplierProductForm.tsx";

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

function createFormRouter(content: ReactNode) {
  const rootRoute = createRootRoute({ component: Outlet });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <p>Signed out home</p>,
  });
  const productsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/supplier/products",
    component: () => <p>My products</p>,
  });
  const newRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/supplier/products/new",
    component: () => content,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([homeRoute, productsRoute, newRoute]),
    history: createMemoryHistory({ initialEntries: ["/supplier/products/new"] }),
  });
}

async function mount(node: ReactNode): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

async function unmount(root: Root): Promise<void> {
  await act(async () => root.unmount());
  document.body.replaceChildren();
}

function labelFor(host: ParentNode, id: string): HTMLLabelElement {
  const match = host.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
  if (!match) throw new Error(`Expected a label for #${id}`);
  return match;
}

describe("supplier product form required fields", () => {
  it.runIf(inBrowser)(
    "marks required fields with a red asterisk and requires a product image",
    async () => {
      const seller = createSessionStore({
        id: "seller-1",
        email: "disha@example.com",
        name: "Disha",
        role: "seller",
      });
      await seller.ready();

      const mounted = await mount(
        <SessionProvider store={seller.store}>
          <RouterProvider router={createFormRouter(<SupplierProductForm />)} />
        </SessionProvider>,
      );

      try {
        const requiredIds = [
          "product-name",
          "product-price",
          "product-unit",
          "product-stock",
          "product-moq",
          "product-image",
        ];
        for (const id of requiredIds) {
          const label = labelFor(mounted.host, id);
          expect(label.getAttribute("data-required")).toBe("true");
          expect(label.textContent).toContain("*");
          expect(label.textContent).toContain("(required)");
        }

        expect(
          labelFor(mounted.host, "product-description").getAttribute("data-required"),
        ).toBeNull();
        expect(labelFor(mounted.host, "product-category").getAttribute("data-required")).toBeNull();

        const image = mounted.host.querySelector<HTMLInputElement>("#product-image");
        expect(image?.required).toBe(true);
        expect(image?.getAttribute("aria-required")).toBe("true");
        expect(mounted.host.textContent).toContain("Required · PNG or JPG, up to 5 MB");
      } finally {
        await unmount(mounted.root);
      }
    },
  );
});
