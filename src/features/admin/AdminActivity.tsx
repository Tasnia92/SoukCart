import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  SearchToolbar,
  StatCard,
  StatGrid,
  TableShell,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import {
  OrderRow,
  PaymentBadge,
  shortId,
  StatusBadge,
  statusLabel,
} from "../orders/order-presentation.tsx";
import { formatDate, formatPrice, initials } from "../workspace/format.ts";
import { WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  filterActivityOrders,
  loadAdminActivity,
  ORDER_STATUSES,
  updateOrderStatus,
  type ActivityOrder,
  type ActivityResponse,
} from "./admin-activity-api.ts";

type AdminActivityProps = {
  loadActivity?: () => Promise<ActivityResponse>;
};

type Notice = { message: string; state: NoticeState } | null;

export function AdminActivity({ loadActivity = loadAdminActivity }: AdminActivityProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);

    void loadActivity()
      .then((response) => {
        if (current) setData(response);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [loadActivity, loadVersion]);

  if (state.status !== "admin") return null;

  const onLogout = () => {
    void store.signOut();
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || "Administrator";

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Admin workspace"
        title="We could not load the admin workspace."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const updateOrder = (orderId: string, patch: Partial<ActivityOrder>) => {
    setData((prev) =>
      prev
        ? { ...prev, orders: prev.orders.map((o) => (o.id === orderId ? { ...o, ...patch } : o)) }
        : prev,
    );
  };

  const changeStatus = (order: ActivityOrder, status: string) => {
    const approved = status === "cancelled" && order.status !== "cancelled";
    const rejecting = order.cancel_requested && status === order.status;
    const message = rejecting
      ? `Reject the cancellation request for order #${shortId(order.id)}?`
      : approved
        ? `Cancel order #${shortId(order.id)} for ${order.retailer_name}? ${order.cancel_requested ? "This approves their cancellation request." : ""}`.trim()
        : `Set order #${shortId(order.id)} to ${statusLabel(status)}?`;
    if (!window.confirm(message)) return;

    setBusyId(order.id);
    void updateOrderStatus(order.id, status)
      .then(() => {
        updateOrder(order.id, { status, cancel_requested: false });
        setNotice(
          rejecting
            ? {
                message: `Cancellation request for #${shortId(order.id)} was rejected.`,
                state: "info",
              }
            : approved
              ? { message: `Order #${shortId(order.id)} was cancelled.`, state: "success" }
              : {
                  message: `Order #${shortId(order.id)} is now ${statusLabel(status)}.`,
                  state: "success",
                },
        );
        setBusyId(null);
      })
      .catch((statusError: unknown) => {
        setNotice({
          message:
            statusError instanceof Error
              ? statusError.message
              : "The order status could not be updated.",
          state: "error",
        });
        setBusyId(null);
      });
  };

  const onSelectChange = (order: ActivityOrder, value: string) => {
    if (value === order.status && !order.cancel_requested) return;
    changeStatus(order, value);
  };

  const orders = data?.orders ?? null;
  const summary = data?.summary ?? null;
  const filtered = orders ? filterActivityOrders(orders, searchTerm, shortId) : [];

  return (
    <WorkspaceShell
      navigationLabel="Admin navigation"
      items={[
        { to: "/admin", icon: "layers", label: "Overview" },
        { to: "/admin/activity", icon: "activity", label: "Order activity", active: true },
        { to: "/admin/complaints", icon: "message", label: "Disputes & Claims" },
        { to: "/admin/users", icon: "person", label: "User directory" },
      ]}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Order activity"
        title="Every order, end to end."
        copy="Who bought what, from whom, and how much."
        actions={
          <Button variant="subtle" disabled={loading} onClick={retry}>
            <Icon name="refresh" />
            <span>Refresh</span>
          </Button>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {data && orders && summary ? (
        <>
          <StatGrid label="Order activity summary">
            <StatCard label="Orders" value={summary.orders} detail="All time" />
            <StatCard label="Revenue" value={formatPrice(summary.revenue)} detail="Paid only" />
            <StatCard label="Retailers" value={summary.retailers} />
            <StatCard label="Suppliers" value={summary.suppliers} />
          </StatGrid>

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
                            <td>{order.lines.reduce((sum, line) => sum + line.quantity, 0)}</td>
                            <td>
                              <strong>{formatPrice(order.total)}</strong>
                            </td>
                            <td>
                              <PaymentBadge
                                paymentStatus={order.payment_status}
                                paymentMethod={order.payment_method}
                                showFailed
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
                            {order.lines.map((line) => (
                              <div className="ad-activity-line" key={line.id}>
                                <span className="ad-activity-product">
                                  <strong>{line.product_name}</strong>
                                  <small>
                                    from {line.supplier_name ?? "an unassigned supplier"}
                                  </small>
                                </span>
                                <span>
                                  {line.quantity} × {formatPrice(line.unit_price)}
                                </span>
                                <strong>{formatPrice(line.amount)}</strong>
                              </div>
                            ))}
                            <div className="ad-order-admin">
                              <label className="ad-order-status-field">
                                <span>Status</span>
                                <select
                                  aria-label={`Order status for #${shortId(order.id)}`}
                                  value={order.status}
                                  disabled={busyId === order.id}
                                  onChange={(event) => onSelectChange(order, event.target.value)}
                                >
                                  {ORDER_STATUSES.map((value) => (
                                    <option value={value} key={value}>
                                      {statusLabel(value)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {order.cancel_requested ? (
                                <div className="ad-cancel-request">
                                  <span className="rt-cancel-flag">
                                    Cancellation requested by {order.retailer_name}
                                  </span>
                                  <button
                                    className="delete-button"
                                    type="button"
                                    disabled={busyId === order.id}
                                    onClick={() => changeStatus(order, "cancelled")}
                                  >
                                    Approve &amp; cancel
                                  </button>
                                  <button
                                    className="button button-subtle"
                                    type="button"
                                    disabled={busyId === order.id}
                                    onClick={() => changeStatus(order, order.status)}
                                  >
                                    <span>Reject request</span>
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </>
                        }
                      />
                    ))
                  ) : (
                    <tr>
                      <td className="admin-empty" colSpan={8}>
                        <strong>No matching orders</strong>
                        <span>Try a different retailer, supplier, or product.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableShell>
          ) : (
            <EmptyState icon="activity" title="No orders yet" copy="New orders show up here." />
          )}
        </>
      ) : (
        <LoadingState title="Loading order activity…" />
      )}
    </WorkspaceShell>
  );
}
