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
import { NotificationsPanel } from "../notifications/NotificationsPanel.tsx";
import { OrderRow, PaymentBadge, shortId, StatusBadge } from "../orders/order-presentation.tsx";
import { formatDate, formatPrice, initials } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import { supplierNavItems } from "./supplier-shared.tsx";
import {
  acceptSupplierOrder,
  canSupplierCancel,
  filterSupplierOrders,
  loadSupplierOrders,
  requestSupplierCancellation,
  type SupplierOrder,
} from "./supplier-orders-api.ts";

type SupplierOrdersProps = {
  loadOrders?: () => Promise<SupplierOrder[]>;
};

type Notice = { message: string; state: NoticeState } | null;

function OrderActions({
  order,
  disabled,
  onAccept,
  onCancel,
}: {
  order: SupplierOrder;
  disabled: boolean;
  onAccept: (order: SupplierOrder) => void;
  onCancel: (order: SupplierOrder) => void;
}) {
  if (order.status === "cancelled") {
    return (
      <span className="admin-muted">
        Cancelled
        {order.manual_refund_status === "pending" ? " · full manual refund pending" : ""}
      </span>
    );
  }
  if (order.cancel_requested) {
    return (
      <span className="admin-muted">
        Cancellation requested by {order.cancellation_initiator ?? "a participant"} · waiting for
        admin
      </span>
    );
  }
  if (order.status === "delivered" && order.delivery_verified_at) {
    return <span className="admin-muted">Delivery verified · supplier cancellation is closed</span>;
  }

  return (
    <>
      {!order.accepted_at && order.status === "pending" ? (
        <button
          className="text-button"
          type="button"
          disabled={disabled}
          onClick={() => onAccept(order)}
        >
          <Icon name="check" />
          <span>Accept order</span>
        </button>
      ) : order.accepted_at ? (
        <span className="admin-muted">Accepted {formatDate(order.accepted_at)}</span>
      ) : null}
      {canSupplierCancel(order) ? (
        <button
          className="text-button rt-cancel-button"
          type="button"
          disabled={disabled}
          onClick={() => onCancel(order)}
        >
          <Icon name="trash" />
          <span>Request cancellation</span>
        </button>
      ) : !order.supplier_can_cancel ? (
        <span className="admin-muted">
          Multi-supplier order · contact admin to resolve your fulfillment
        </span>
      ) : null}
    </>
  );
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
        title="We could not load your orders."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const onAccept = (order: SupplierOrder) => {
    if (!window.confirm(`Accept order #${shortId(order.id)} from ${order.retailer_name}?`)) return;

    setBusyId(order.id);
    void acceptSupplierOrder(order.id)
      .then((acceptedAt) => {
        setOrders(
          (prev) =>
            prev?.map((current) =>
              current.id === order.id ? { ...current, accepted_at: acceptedAt } : current,
            ) ?? prev,
        );
        setNotice({
          message: `Order #${shortId(order.id)} was accepted. The admin team will manage its status.`,
          state: "success",
        });
      })
      .catch((acceptError: unknown) => {
        setNotice({
          message:
            acceptError instanceof Error ? acceptError.message : "The order could not be accepted.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const onCancel = (order: SupplierOrder) => {
    const reason = window.prompt(
      `Why should order #${shortId(order.id)} be cancelled? A paid online order will require a full manual refund.`,
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setNotice({ message: "Add a cancellation reason.", state: "error" });
      return;
    }

    setBusyId(order.id);
    void requestSupplierCancellation(order.id, reason)
      .then(() => {
        setOrders(
          (prev) =>
            prev?.map((current) =>
              current.id === order.id
                ? {
                    ...current,
                    cancel_requested: true,
                    cancellation_initiator: "supplier",
                    cancellation_reason: reason.trim(),
                  }
                : current,
            ) ?? prev,
        );
        setNotice({
          message: `Cancellation of order #${shortId(order.id)} was requested. The retailer, admin, and other suppliers were notified.`,
          state: "info",
        });
      })
      .catch((cancelError: unknown) => {
        setNotice({
          message:
            cancelError instanceof Error
              ? cancelError.message
              : "The cancellation request could not be submitted.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
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
        copy="Accept incoming orders or request cancellation before delivery is verified. The admin completes all refunds manually."
        actions={
          <RouterLink className="button button-subtle" to="/supplier/stock">
            <Icon name="layers" />
            <span>Manage stock</span>
          </RouterLink>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      <NotificationsPanel />
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
                              {order.accepted_at ? (
                                <span className="rt-cancel-flag">Accepted</span>
                              ) : null}
                              {order.cancel_requested ? (
                                <span className="rt-cancel-flag">
                                  Cancel requested by {order.cancellation_initiator}
                                </span>
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
                            {order.cancellation_reason ? (
                              <p className="rt-order-notes">
                                <strong>Cancellation reason:</strong> {order.cancellation_reason}
                              </p>
                            ) : null}
                            <div className="rt-order-detail-actions">
                              <OrderActions
                                order={order}
                                disabled={busyId === order.id}
                                onAccept={onAccept}
                                onCancel={onCancel}
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
