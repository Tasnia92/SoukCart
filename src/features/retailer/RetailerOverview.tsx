import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  StatCard,
  StatGrid,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { PaymentBadge, shortId, StatusBadge } from "../orders/order-presentation.tsx";
import { firstName, formatDate, formatPrice } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import { consumeRetailerNotice } from "./retailer-flash.ts";
import { orderTotal, type RetailerOrder } from "./retailer-orders-api.ts";
import {
  getRetailerOverviewStats,
  loadRetailerOverview,
  type RetailerOverviewData,
} from "./retailer-overview-api.ts";

type RetailerOverviewProps = {
  loadOverview?: (retailerId: string) => Promise<RetailerOverviewData>;
};

function RecentOrderCard({ order }: { order: RetailerOrder }) {
  const units = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <RouterLink className="rt-order-card" to="/retailer/orders">
      <span className="rt-order-art">
        <Icon name={order.status === "delivered" ? "check" : "package"} />
      </span>
      <span className="rt-order-card-body">
        <strong className="rt-order-id">#{shortId(order.id)}</strong>
        <small>
          {units} items · {formatDate(order.created_at)}
        </small>
      </span>
      <span className="rt-order-card-end">
        <strong>{formatPrice(orderTotal(order))}</strong>
        <PaymentBadge paymentStatus={order.payment_status} paymentMethod={order.payment_method} />
        <StatusBadge status={order.status} />
      </span>
    </RouterLink>
  );
}

export function RetailerOverview({ loadOverview = loadRetailerOverview }: RetailerOverviewProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer" });
  const [data, setData] = useState<RetailerOverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice] = useState(consumeRetailerNotice);

  const retailerId = state.status === "retailer" ? state.session.user.id : "";

  useEffect(() => {
    if (!retailerId) return;
    let current = true;
    setError(null);

    void loadOverview(retailerId)
      .then((next) => {
        if (current) setData(next);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadOverview, loadVersion, retailerId]);

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
        title="We could not load your workspace."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const orders = data?.orders ?? null;
  const cartCount = data?.cartCount ?? 0;
  const stats = data ? getRetailerOverviewStats(data.orders, data.cartCount) : null;
  const recent = orders ? orders.slice(0, 4) : [];

  return (
    <WorkspaceShell
      navigationLabel="Retailer navigation"
      items={[
        { to: "/retailer", icon: "home", label: "Overview", active: true },
        { to: "/retailer/catalog", icon: "bag", label: "Place order" },
        {
          to: "/retailer/cart",
          icon: "cart",
          label: "Cart",
          trailing: cartCount ? <span className="rt-nav-badge">{cartCount}</span> : undefined,
        },
        { to: "/retailer/orders", icon: "package", label: "My orders" },
        { to: "/retailer/complaints", icon: "message", label: "Help Center" },
      ]}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Retailer workspace"
        title={`Good to see you, ${firstName(userName)}.`}
        copy="Browse suppliers, build an order, and track every delivery from one place."
        actions={
          <>
            <RouterLink className="button button-primary" to="/retailer/catalog">
              <Icon name="bag" />
              <span>Place order</span>
            </RouterLink>
            <RouterLink className="button button-subtle" to="/retailer/orders">
              <Icon name="package" />
              <span>My orders</span>
            </RouterLink>
          </>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {data && orders && stats ? (
        <>
          <StatGrid label="Order summary">
            <StatCard label="Orders placed" value={stats.orders} detail="All time" />
            <StatCard label="Pending" value={stats.pending} detail="Awaiting confirmation" />
            <StatCard label="Delivered" value={stats.delivered} detail="Completed orders" />
            <StatCard label="In cart" value={stats.inCart} detail="Items ready to order" />
          </StatGrid>

          <section className="rt-section" aria-labelledby="recent-heading">
            <div className="rt-section-heading">
              <div>
                <p className="eyebrow">Latest activity</p>
                <h2 id="recent-heading" className="display-sm">
                  Recent orders
                </h2>
              </div>
              <RouterLink className="text-button" to="/retailer/orders">
                View all
              </RouterLink>
            </div>
            {recent.length ? (
              <div className="rt-order-list">
                {recent.map((order) => (
                  <RecentOrderCard key={order.id} order={order} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="store"
                title="No orders yet"
                copy="Start with the catalog and place your first order."
                action={
                  <RouterLink className="button button-primary" to="/retailer/catalog">
                    <span>Place order</span>
                  </RouterLink>
                }
              />
            )}
          </section>
        </>
      ) : (
        <LoadingState title="Loading your workspace…" />
      )}
    </WorkspaceShell>
  );
}
