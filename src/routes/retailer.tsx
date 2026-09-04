import { createFileRoute, Outlet } from "@tanstack/react-router";
import { guardAuthArea, publicPaymentPathSet } from "../lib/route-guards.ts";

export const Route = createFileRoute("/retailer")({
  beforeLoad: async ({ context, location }) => {
    // Public SSLCommerz result pages must not require a retailer session.
    if (publicPaymentPathSet.has(location.pathname)) {
      return;
    }
    await guardAuthArea(context.session, "retailer");
  },
  component: Outlet,
});
