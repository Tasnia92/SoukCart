import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { RetailerOrders } from "../../features/retailer/RetailerOrders.tsx";

export const Route = createFileRoute("/retailer/orders")({
  component: OrdersLayout,
});

function OrdersLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname === "/retailer/orders") {
    return <RetailerOrders />;
  }
  return <Outlet />;
}
