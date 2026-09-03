import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  Download,
  House,
  MessageSquare,
  Package,
  RefreshCw,
  ShoppingBag,
  ShoppingCart,
  Store,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
      return (
        <p className="text-sm text-muted-foreground">Historical refund requires admin review</p>
      );
    }
    if (order.manual_refund_status === "pending") {
      return (
        <p className="text-sm text-muted-foreground">
          Manual refund pending · {formatPrice(order.refund_amount)}
        </p>
      );
    }
    if (order.manual_refund_status === "completed") {
      return (
        <p className="text-sm text-muted-foreground">
          Refund completed · {formatPrice(order.refund_amount)}
        </p>
      );
    }
    return (
      <p className="text-sm text-muted-foreground">Order cancelled · no advance refund required</p>
    );
  }

  if (order.cancel_requested) {
    return (
      <p className="text-sm text-muted-foreground">
        Cancellation requested · waiting for admin approval
      </p>
    );
  }

  if (order.status === "delivered" && order.delivery_verified_at) {
    return (
      <Button asChild variant="outline" size="sm">
        <a href={`/retailer/complaints?order=${encodeURIComponent(order.id)}`}>
          <MessageSquare data-icon="inline-start" />
          Contact support for cancellation or refund
        </a>
      </Button>
    );
  }

  return (
    <>
      {order.status === "delivered" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onVerifyDelivery(order)}
        >
          <Check data-icon="inline-start" />
          Verify delivery
        </Button>
      ) : null}
      {canCancelOrder(order) ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={disabled}
          onClick={() => onCancel(order)}
        >
          <Trash2 data-icon="inline-start" />
          Request cancellation
        </Button>
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
        { to: "/retailer", icon: House, label: "Overview" },
        { to: "/retailer/catalog", icon: ShoppingBag, label: "Place order" },
        {
          to: "/retailer/cart",
          icon: ShoppingCart,
          label: "Cart",
          trailing: cartCount || undefined,
        },
        { to: "/retailer/orders", icon: Package, label: "My orders", active: true },
        { to: "/retailer/complaints", icon: MessageSquare, label: "Help Center" },
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
          <Button asChild>
            <RouterLink to="/retailer/catalog">
              <ShoppingBag data-icon="inline-start" />
              Place order
            </RouterLink>
          </Button>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      <NotificationsPanel />
      {orders ? (
        orders.length ? (
          <TableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Placed</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Details</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <OrderRow
                    key={order.id}
                    colSpan={6}
                    toggleLabel={`Toggle details for order #${shortId(order.id)}`}
                    summaryCells={
                      <>
                        <TableCell>
                          <strong className="font-medium">#{shortId(order.id)}</strong>
                        </TableCell>
                        <TableCell>{formatDate(order.created_at)}</TableCell>
                        <TableCell>
                          {order.items.reduce((sum, item) => sum + item.quantity, 0)}
                        </TableCell>
                        <TableCell>
                          <strong>{formatPrice(orderTotal(order))}</strong>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <PaymentBadge
                              paymentStatus={order.payment_status}
                              paymentMethod={order.payment_method}
                            />
                            <StatusBadge status={order.status} />
                            {order.delivery_verified_at ? (
                              <Badge variant="secondary">Delivery verified</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                      </>
                    }
                    detail={
                      <div className="flex flex-col gap-4">
                        <ul className="flex flex-col gap-2">
                          {order.items.map((item) => (
                            <li
                              className="grid gap-1 text-sm sm:grid-cols-[1fr_auto_auto] sm:gap-4"
                              key={item.id}
                            >
                              <span className="font-medium">{item.product_name}</span>
                              <span className="text-muted-foreground">
                                {item.quantity} × {formatPrice(item.unit_price)}
                              </span>
                              <strong className="sm:text-right">
                                {formatPrice(item.unit_price * item.quantity)}
                              </strong>
                            </li>
                          ))}
                        </ul>
                        {order.notes ? (
                          <Alert role="note">
                            <MessageSquare />
                            <AlertTitle>Order notes</AlertTitle>
                            <AlertDescription>{order.notes}</AlertDescription>
                          </Alert>
                        ) : null}
                        {order.status === "cancelled" &&
                        order.manual_refund_status !== "not_required" ? (
                          <Alert role="note">
                            <RefreshCw />
                            <AlertTitle>Refund details</AlertTitle>
                            <AlertDescription>
                              {formatPrice(order.refund_amount)} · platform charge{" "}
                              {formatPrice(order.platform_charge)} · delivery charge{" "}
                              {formatPrice(order.delivery_charge)}
                            </AlertDescription>
                          </Alert>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2">
                          {order.payment_status === "paid" ? (
                            <Button asChild variant="outline" size="sm">
                              <RouterLink
                                to="/retailer/orders/$orderId/invoice"
                                params={{ orderId: order.id }}
                              >
                                <Download data-icon="inline-start" />
                                Download invoice
                              </RouterLink>
                            </Button>
                          ) : null}
                          {order.payment_status === "unpaid" && order.tran_id ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busyId === order.id}
                              onClick={() => onVerifyPayment(order)}
                            >
                              <RefreshCw data-icon="inline-start" />
                              Verify payment
                            </Button>
                          ) : null}
                          <CancelAction
                            order={order}
                            disabled={busyId === order.id}
                            onCancel={onCancel}
                            onVerifyDelivery={onVerifyDelivery}
                          />
                        </div>
                      </div>
                    }
                  />
                ))}
              </TableBody>
            </Table>
          </TableShell>
        ) : (
          <EmptyState
            icon={Store}
            title="No orders yet"
            copy="Place your first order and it will show up here."
            action={
              <Button asChild>
                <RouterLink to="/retailer/catalog">Place order</RouterLink>
              </Button>
            }
          />
        )
      ) : (
        <LoadingState title="Loading your orders…" />
      )}
    </WorkspaceShell>
  );
}
