import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { RetailerOrderDetail } from "../../features/retailer/RetailerOrderDetail.tsx";

export const Route = createFileRoute("/retailer/orders/$orderId")({
  component: OrderIdLayout,
});

function OrderIdLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { orderId } = Route.useParams();
  if (pathname.endsWith("/invoice")) {
    return <Outlet />;
  }
  return <RetailerOrderDetail orderId={orderId} />;
}
