import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PackageSearch, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { StatusBadge, shortId } from "../orders/order-presentation.tsx";
import { searchParam } from "../workspace/search.ts";
import {
  deliveryAgeDays,
  loadCartCount,
  loadRetailerOrders,
  type RetailerOrder,
} from "./retailer-orders-api.ts";
import { buildShipmentCards } from "./retailer-dashboard-api.ts";
import { ShipmentTracker, placedAgoLabel } from "./Shipments.tsx";
import { useRetailerOrderChanges } from "./retailer-realtime.ts";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";

type RetailerTrackingProps = {
  loadOrders?: (retailerId: string) => Promise<RetailerOrder[]>;
  loadCart?: (userId: string) => Promise<number>;
};

/**
 * Live tracking for everything still on its way: one full tracker per active
 * order — package stepper, carrier tracking details, and the carrier's event
 * history. Delivered and cancelled orders stay in the Orders list.
 */
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

  /** Active orders oldest first — the parcel landing soonest leads the page. */
  const inTransit = useMemo(() => {
    const byId = new Map((orders ?? []).map((order) => [order.id, order]));
    return buildShipmentCards(orders ?? [])
      .map((card) => byId.get(card.orderId))
      .filter((order): order is RetailerOrder => Boolean(order));
  }, [orders]);

  useEffect(() => {
    if (!focusOrderId || !orders) return;
    const el = document.getElementById(`track-${focusOrderId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusOrderId, orders]);

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
        eyebrow="Ordering & delivery"
        title="Tracking."
        copy="Live status for every parcel on its way to you — carrier events update here as they happen."
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
          <div className="grid gap-4 xl:grid-cols-2">
            {inTransit.map((order) => (
              <Card
                key={order.id}
                id={`track-${order.id}`}
                data-state={focusOrderId === order.id ? "selected" : undefined}
                className={cn(
                  "scroll-mt-24",
                  focusOrderId === order.id && "border-primary ring-2 ring-primary/30",
                )}
              >
                <CardHeader>
                  <CardTitle className="text-sm font-medium">#{shortId(order.id)}</CardTitle>
                  <CardDescription>
                    {placedAgoLabel(deliveryAgeDays(order))}
                    {order.packages.length > 1 ? ` · ${order.packages.length} packages` : ""}
                  </CardDescription>
                  <CardAction>
                    <StatusBadge status={order.status} />
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <ShipmentTracker order={order} />
                </CardContent>
                <CardFooter className="justify-between">
                  <Badge variant="secondary">{statusCountLabel(order)}</Badge>
                  <Button asChild variant="ghost" size="sm">
                    <RouterLink to="/retailer/orders" search={{ order: order.id }}>
                      View order
                    </RouterLink>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Truck}
            title="Nothing in transit"
            copy="When a supplier ships an order, its carrier tracking shows up here."
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

/** One-line summary of how many parcels are still moving on this order. */
function statusCountLabel(order: RetailerOrder): string {
  const moving = order.packages.filter((pkg) => pkg.status !== "declined").length;
  if (moving <= 1) return "1 package on the way";
  return `${moving} packages on the way`;
}
