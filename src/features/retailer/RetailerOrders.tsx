import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  TableShell,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { NotificationsPanel } from "../notifications/NotificationsPanel.tsx";
import { OrderRow, PaymentBadge, shortId, StatusBadge } from "../orders/order-presentation.tsx";
import { formatDate, formatPrice } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  canCancelOrder,
  clearCart,
  confirmOrderDelivery,
  loadCartCount,
  loadRetailerOrders,
  orderTotal,
  queryPaymentStatus,
  requestOrderCancellation,
  type RetailerOrder,
} from "./retailer-orders-api.ts";

type RetailerOrdersProps = {
  loadOrders?: (retailerId: string) => Promise<RetailerOrder[]>;
  loadCart?: (userId: string) => Promise<number>;
};

type Notice = { message: string; state: NoticeState } | null;

function CancelAction({
  order,
  disabled,
  onCancel,
  onVerifyDelivery,
}: {
  order: RetailerOrder;
  disabled: boolean;
  onCancel: (order: RetailerOrder) => void;
  onVerifyDelivery: (order: RetailerOrder) => void;
}) {
  if (order.status === "cancelled") {
    if (order.manual_refund_status === "review_required") {
      return <span className="admin-muted">Historical refund requires admin review</span>;
    }
    if (order.manual_refund_status === "pending") {
      return (
        <span className="admin-muted">
          Manual refund pending · {formatPrice(order.refund_amount)}
        </span>
      );
    }
    if (order.manual_refund_status === "completed") {
      return (
        <span className="admin-muted">Refund completed · {formatPrice(order.refund_amount)}</span>
      );
    }
    return <span className="admin-muted">Order cancelled · no advance refund required</span>;
  }

  if (order.cancel_requested) {
    return <span className="admin-muted">Cancellation requested · waiting for admin approval</span>;
  }

  if (order.status === "delivered" && order.delivery_verified_at) {
    return (
      <a
        className="text-button"
        href={`/retailer/complaints?order=${encodeURIComponent(order.id)}`}
      >
        <Icon name="message" />
        <span>Contact support for cancellation or refund</span>
      </a>
    );
  }

  return (
    <>
      {order.status === "delivered" ? (
        <button
          className="text-button"
          type="button"
          disabled={disabled}
          onClick={() => onVerifyDelivery(order)}
        >
          <Icon name="check" />
          <span>Verify delivery</span>
        </button>
      ) : null}
      {canCancelOrder(order) ? (
        <button
          className="text-button rt-cancel-button"
          type="button"
          disabled={disabled}
          onClick={() => onCancel(order)}
        >
          <Icon name="trash" />
          <span>Request cancellation</span>
        </button>
      ) : null}
    </>
  );
}

export function RetailerOrders({
  loadOrders = loadRetailerOrders,
  loadCart = loadCartCount,
}: RetailerOrdersProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer/orders" });
  const [orders, setOrders] = useState<RetailerOrder[] | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const retailerId = state.status === "retailer" ? state.session.user.id : "";

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

  const updateOrder = (orderId: string, patch: Partial<RetailerOrder>) => {
    setOrders((prev) => prev?.map((o) => (o.id === orderId ? { ...o, ...patch } : o)) ?? prev);
  };

  const onVerifyPayment = (order: RetailerOrder) => {
    if (!order.tran_id) return;
    setBusyId(order.id);
    void queryPaymentStatus(order.tran_id).then(async (result) => {
      if (result === "paid" || result === "failed" || result === "cancelled") {
        if (result === "paid") {
          await clearCart(retailerId);
          setCartCount(0);
        }
        updateOrder(order.id, { payment_status: result });
        setBusyId(null);
      } else {
        setBusyId(null);
        setNotice({
          message: "Payment not found yet. Please try again in a moment.",
          state: "info",
        });
      }
    });
  };

  const onVerifyDelivery = (order: RetailerOrder) => {
    if (!window.confirm(`Confirm that order #${shortId(order.id)} was delivered?`)) return;

    setBusyId(order.id);
    void confirmOrderDelivery(order.id)
      .then((verifiedAt) => {
        updateOrder(order.id, { delivery_verified_at: verifiedAt });
        setNotice({
          message: `Delivery of order #${shortId(order.id)} was verified. Future cancellation requests must go through support.`,
          state: "success",
        });
      })
      .catch((verifyError: unknown) => {
        setNotice({
          message:
            verifyError instanceof Error ? verifyError.message : "Delivery could not be verified.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const onCancel = (order: RetailerOrder) => {
    if (!canCancelOrder(order)) return;
    const paidInAdvance = order.payment_method === "online" && order.payment_status === "paid";
    const message = `Request cancellation of order #${shortId(order.id)}? The admin team will review it${paidInAdvance ? " and manually refund the eligible amount after platform and delivery charges" : ""}.`;
    if (!window.confirm(message)) return;

    setBusyId(order.id);
    void requestOrderCancellation(order.id)
      .then(() => {
        updateOrder(order.id, {
          cancel_requested: true,
          cancellation_initiator: "retailer",
        });
        setNotice({
          message: `Cancellation of order #${shortId(order.id)} was requested. The admin and suppliers were notified.`,
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

  return (
    <WorkspaceShell
      navigationLabel="Retailer navigation"
      items={[
        { to: "/retailer", icon: "home", label: "Overview" },
        { to: "/retailer/catalog", icon: "bag", label: "Place order" },
        {
          to: "/retailer/cart",
          icon: "cart",
          label: "Cart",
          trailing: cartCount ? <span className="rt-nav-badge">{cartCount}</span> : undefined,
        },
        { to: "/retailer/orders", icon: "package", label: "My orders", active: true },
        { to: "/retailer/complaints", icon: "message", label: "Help Center" },
      ]}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Order history"
        title="My orders."
        copy="Every order you place, from confirmation to delivery."
        actions={
          <RouterLink className="button button-primary" to="/retailer/catalog">
            <Icon name="bag" />
            <span>Place order</span>
          </RouterLink>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      <NotificationsPanel />
      {orders ? (
        orders.length ? (
          <TableShell>
            <table className="admin-table rt-orders-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <OrderRow
                    key={order.id}
                    colSpan={6}
                    toggleLabel={`Toggle details for order #${shortId(order.id)}`}
                    summaryCells={
                      <>
                        <td>
                          <strong className="rt-order-id">#{shortId(order.id)}</strong>
                        </td>
                        <td>{formatDate(order.created_at)}</td>
                        <td>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
                        <td>
                          <strong>{formatPrice(orderTotal(order))}</strong>
                        </td>
                        <td>
                          <PaymentBadge
                            paymentStatus={order.payment_status}
                            paymentMethod={order.payment_method}
                          />
                          <StatusBadge status={order.status} />
                          {order.delivery_verified_at ? (
                            <span className="rt-cancel-flag">Delivery verified</span>
                          ) : null}
                        </td>
                      </>
                    }
                    detail={
                      <>
                        {order.items.map((item) => (
                          <div className="rt-order-item-row" key={item.id}>
                            <span>{item.product_name}</span>
                            <span>
                              {item.quantity} × {formatPrice(item.unit_price)}
                            </span>
                            <strong>{formatPrice(item.unit_price * item.quantity)}</strong>
                          </div>
                        ))}
                        {order.notes ? (
                          <p className="rt-order-notes">
                            <strong>Notes:</strong> {order.notes}
                          </p>
                        ) : null}
                        {order.status === "cancelled" &&
                        order.manual_refund_status !== "not_required" ? (
                          <p className="rt-order-notes">
                            <strong>Refund:</strong> {formatPrice(order.refund_amount)} · platform
                            charge {formatPrice(order.platform_charge)} · delivery charge{" "}
                            {formatPrice(order.delivery_charge)}
                          </p>
                        ) : null}
                        <div className="rt-order-detail-actions">
                          {order.payment_status === "paid" ? (
                            <RouterLink
                              className="text-button rt-invoice-link"
                              to="/retailer/orders/$orderId/invoice"
                              params={{ orderId: order.id }}
                            >
                              <Icon name="download" />
                              <span>Download invoice</span>
                            </RouterLink>
                          ) : null}
                          {order.payment_status === "unpaid" && order.tran_id ? (
                            <button
                              className="text-button rt-invoice-link"
                              type="button"
                              disabled={busyId === order.id}
                              onClick={() => onVerifyPayment(order)}
                            >
                              <Icon name="refresh" />
                              <span>Verify payment</span>
                            </button>
                          ) : null}
                          <CancelAction
                            order={order}
                            disabled={busyId === order.id}
                            onCancel={onCancel}
                            onVerifyDelivery={onVerifyDelivery}
                          />
                        </div>
                      </>
                    }
                  />
                ))}
              </tbody>
            </table>
          </TableShell>
        ) : (
          <EmptyState
            icon="store"
            title="No orders yet"
            copy="Place your first order and it will show up here."
            action={
              <RouterLink className="button button-primary" to="/retailer/catalog">
                <span>Place order</span>
              </RouterLink>
            }
          />
        )
      ) : (
        <LoadingState title="Loading your orders…" />
      )}
    </WorkspaceShell>
  );
}
