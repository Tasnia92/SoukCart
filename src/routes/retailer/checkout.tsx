import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { RetailerCheckout } from "../../features/retailer/RetailerCheckout.tsx";

export const Route = createFileRoute("/retailer/checkout")({
  component: CheckoutLayout,
});

function CheckoutLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Nested success/failed/cancelled must render through the outlet.
  if (pathname === "/retailer/checkout") {
    return <RetailerCheckout />;
  }
  return <Outlet />;
}
