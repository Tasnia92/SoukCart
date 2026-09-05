import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PackageSearch, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { searchParam } from "../workspace/search.ts";
import { loadCartCount, loadRetailerOrders, type RetailerOrder } from "./retailer-orders-api.ts";
import { buildShipmentCards } from "./retailer-dashboard-api.ts";
import { useRetailerOrderChanges } from "./retailer-realtime.ts";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";
import { RetailerOrderStatusView } from "./RetailerOrderTracker.tsx";

type RetailerTrackingProps = {
  loadOrders?: (retailerId: string) => Promise<RetailerOrder[]>;
  loadCart?: (userId: string) => Promise<number>;
};

export function RetailerTracking({
  loadOrders = loadRetailerOrders,
  loadCart = loadCartCount,
}: RetailerTrackingProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer/tracking" });
  const searchStr = useRouterState({ select: (routerState) => routerState.location.searchStr });
  const focusOrderId = searchParam(searchStr, "order");
  const [orders, setOrders] = useState<RetailerOrder[] | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  const retailerId = state.status === "retailer" ? state.session.user.id : "";

  useRetailerOrderChanges({
    enabled: Boolean(retailerId),
    retailerId: retailerId || undefined,
    onChange: () => setLoadVersion((version) => version + 1),
  });

  useEffect(() => {
    if (!retailerId) return;
    let current = true;
    setError(null);

    void Promise.all([loadOrders(retailerId), loadCart(retailerId)])
      .then(([nextOrders, nextCartCount]) => {
        if (!current) return;
        setOrders(nextOrders);
        setCartCount(nextCartCount);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadCart, loadOrders, loadVersion, retailerId]);

  const inTransit = useMemo(() => {
    const byId = new Map((orders ?? []).map((order) => [order.id, order]));
    return buildShipmentCards(orders ?? [])
      .map((card) => byId.get(card.orderId))
      .filter((order): order is RetailerOrder => Boolean(order));
  }, [orders]);

  useEffect(() => {
    if (!focusOrderId) return;
    void navigate({
      to: "/retailer/orders/$orderId",
      params: { orderId: focusOrderId },
    });
  }, [focusOrderId, navigate]);

  if (state.status !== "retailer") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || state.profile.email;

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Retailer workspace"
        title="We could not load your tracking."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  return (
    <RetailerWorkspaceShell
      section="tracking"
      userName={userName}
      userEmail={state.profile.email}
      cartCount={cartCount}
      inTransitCount={orders ? inTransit.length : undefined}
      onLogout={onLogout}
    >
      <PageHeader
        title="Tracking"
        actions={
          <Button asChild variant="outline">
            <RouterLink to="/retailer/orders">
              <PackageSearch data-icon="inline-start" />
              View orders
            </RouterLink>
          </Button>
        }
      />

      {orders ? (
        inTransit.length ? (
          <div className="flex flex-col gap-10">
            {inTransit.map((order) => (
              <div className="flex flex-col gap-4" key={order.id} id={`track-${order.id}`}>
                <RetailerOrderStatusView
                  order={order}
                  actions={
                    <Button asChild variant="outline">
                      <RouterLink to="/retailer/orders/$orderId" params={{ orderId: order.id }}>
                        View order
                      </RouterLink>
                    </Button>
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Truck}
            title="Nothing in transit"
            copy="When a supplier ships an order, tracking shows up here."
            action={
              <Button asChild>
                <RouterLink to="/retailer">Place order</RouterLink>
              </Button>
            }
          />
        )
      ) : (
        <LoadingState title="Loading your shipments…" />
      )}
    </RetailerWorkspaceShell>
  );
}
