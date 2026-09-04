import { createFileRoute, useRouterState } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { RootAuthRoute } from "../components/auth/AuthRoutes.tsx";
import { PaymentReturn } from "../features/retailer/PaymentReturn.tsx";
import { guardAuthArea, isRootPaymentLocation } from "../lib/route-guards.ts";

export const Route = createFileRoute("/")({
  beforeLoad: async ({ context, location }) => {
    // SSLCommerz returns land on /?status=… (or a flash key); skip signed-in redirects.
    if (isRootPaymentLocation(location)) {
      return;
    }
    await guardAuthArea(context.session, "root");
  },
  component: RootRoute,
});

function RootRoute(): ReactElement {
  const location = useRouterState({ select: (state) => state.location });
  if (isRootPaymentLocation(location)) {
    return <PaymentReturn key={location.href} />;
  }
  return <RootAuthRoute />;
}
