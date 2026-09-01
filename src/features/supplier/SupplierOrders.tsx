import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  SearchToolbar,
  TableShell,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { OrderRow, PaymentBadge, shortId, StatusBadge } from "../orders/order-presentation.tsx";
import { formatDate, formatPrice, initials } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import { supplierNavItems } from "./supplier-shared.tsx";
import {
  filterSupplierOrders,
  loadSupplierOrders,
  setSupplierOrderStatus,
  type SupplierOrder,
} from "./supplier-orders-api.ts";

type SupplierOrdersProps = {
  loadOrders?: () => Promise<SupplierOrder[]>;
};

type Notice = { message: string; state: NoticeState } | null;

function OrderActions({
  order,
  disabled,
  onStatus,
}: {
  order: SupplierOrder;
  disabled: boolean;
  onStatus: (order: SupplierOrder, next: "confirmed" | "shipped") => void;
}) {
  if (order.cancel_requested && order.status === "confirmed") {
    return (
      <span className="admin-muted">
        The retailer asked to cancel. The admin team will resolve it.
      </span>
    );
  }
  if (order.status === "pending") {
    return (
      <button
        className="text-button"
        type="button"
        disabled={disabled}
        onClick={() => onStatus(order, "confirmed")}
      >
        <Icon name="check" />
        <span>Confirm order</span>
      </button>
    );
  }
  if (order.status === "confirmed") {
    return (
      <button
        className="text-button"
        type="button"
        disabled={disabled}
        onClick={() => onStatus(order, "shipped")}
      >
        <Icon name="truck" />
        <span>Mark shipped</span>
      </button>
    );
  }
  if (order.status === "shipped") {
    return <span className="admin-muted">Shipped · waiting for delivery to be confirmed.</span>;
  }
  return null;
}

export function SupplierOrders({ loadOrders = loadSupplierOrders }: SupplierOrdersProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/orders" });
  const [orders, setOrders] = useState<SupplierOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isSeller = state.status === "seller";

  useEffect(() => {
    if (!isSeller) return;
    let current = true;
    setError(null);

    void loadOrders()
      .then((nextOrders) => {
        if (current) setOrders(nextOrders);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [isSeller, loadOrders, loadVersion]);

  if (state.status !== "seller") return null;

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
        eyebrow="Supplier workspace"
        title="We could not load your catalog."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const onStatus = (order: SupplierOrder, next: "confirmed" | "shipped") => {
    const message =
      next === "confirmed"
        ? `Confirm order #${shortId(order.id)} for ${order.retailer_name}? They will see it as confirmed.`
        : `Mark order #${shortId(order.id)} as shipped for ${order.retailer_name}?`;
    if (!window.confirm(message)) return;

    setBusyId(order.id);
    void setSupplierOrderStatus(order.id, next)
      .then((status) => {
        setOrders((prev) => prev?.map((o) => (o.id === order.id ? { ...o, status } : o)) ?? prev);
        setNotice({
          message:
            next === "confirmed"
              ? `Order #${shortId(order.id)} is confirmed.`
              : `Order #${shortId(order.id)} is marked shipped.`,
          state: "success",
        });
        setBusyId(null);
      })
      .catch((statusError: unknown) => {
        setNotice({
          message:
            statusError instanceof Error ? statusError.message : "The order could not be updated.",
          state: "error",
        });
        setBusyId(null);
      });
  };

  const filtered = orders ? filterSupplierOrders(orders, searchTerm, shortId) : [];

  return (
    <WorkspaceShell
      navigationLabel="Supplier navigation"
      items={supplierNavItems("orders")}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Order fulfillment"
        title="Orders."
        copy="Confirm incoming orders and mark them shipped once dispatched."
        actions={
          <RouterLink className="button button-subtle" to="/supplier/stock">
            <Icon name="layers" />
            <span>Manage stock</span>
          </RouterLink>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {orders ? (
        <>
          <SearchToolbar
            label="Search orders"
            placeholder="Search orders"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            result={`${filtered.length} of ${orders.length} orders`}
          />
          {orders.length ? (
            <TableShell>
              <table className="admin-table rt-orders-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Placed</th>
                    <th>Retailer</th>
                    <th>Units</th>
                    <th>Total</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Order lines</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length ? (
                    filtered.map((order) => (
                      <OrderRow
                        key={order.id}
                        colSpan={8}
                        toggleLabel={`Toggle lines for order #${shortId(order.id)}`}
                        summaryCells={
                          <>
                            <td>
                              <strong className="rt-order-id">#{shortId(order.id)}</strong>
                            </td>
                            <td>{formatDate(order.created_at)}</td>
                            <td>
                              <div className="admin-user-cell">
                                <span className="admin-avatar">
                                  {initials(order.retailer_name)}
                                </span>
                                <span>
                                  <strong>{order.retailer_name}</strong>
                                  <small>{order.retailer_email}</small>
                                </span>
                              </div>
                            </td>
                            <td>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
                            <td>
                              <strong>{formatPrice(order.supplier_total)}</strong>
                            </td>
                            <td>
                              <PaymentBadge
                                paymentStatus={order.payment_status}
                                paymentMethod={order.payment_method}
                              />
                            </td>
                            <td>
                              <StatusBadge status={order.status} />
                              {order.cancel_requested ? (
                                <span className="rt-cancel-flag">Cancel requested</span>
                              ) : null}
                            </td>
                          </>
                        }
                        detail={
                          <>
                            {order.items.map((item) => (
                              <div className="ad-activity-line" key={item.id}>
                                <span className="ad-activity-product">
                                  <strong>{item.product_name}</strong>
                                </span>
                                <span>
                                  {item.quantity} × {formatPrice(item.unit_price)}
                                </span>
                                <strong>{formatPrice(item.line_total)}</strong>
                              </div>
                            ))}
                            {order.notes ? (
                              <p className="rt-order-notes">
                                <strong>Notes:</strong> {order.notes}
                              </p>
                            ) : null}
                            <div className="rt-order-detail-actions">
                              <OrderActions
                                order={order}
                                disabled={busyId === order.id}
                                onStatus={onStatus}
                              />
                            </div>
                          </>
                        }
                      />
                    ))
                  ) : (
                    <tr>
                      <td className="admin-empty" colSpan={8}>
                        <strong>No matching orders</strong>
                        <span>Try a different order number, retailer, or product.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableShell>
          ) : (
            <EmptyState
              icon="package"
              title="No orders yet"
              copy="Orders that include your products will show up here."
            />
          )}
        </>
      ) : (
        <LoadingState title="Loading your orders…" />
      )}
    </WorkspaceShell>
  );
}
