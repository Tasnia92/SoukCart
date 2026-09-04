import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  MessageSquare,
  Package,
  RefreshCw,
  ShoppingBag,
  Trash2,
} from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  TableShell,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { OrderTrackingPanel } from "../orders/OrderTracking.tsx";
import {
  DeliveryDetails,
  OrderRow,
  PaymentBadge,
  shortId,
  StatusBadge,
} from "../orders/order-presentation.tsx";
import { searchParam } from "../workspace/search.ts";
import { formatDate, formatPrice } from "../workspace/format.ts";
import {
  canCancelOrder,
  canRequestCodDeliveryRefund,
  clearCart,
  confirmOrderDelivery,
  loadCartCount,
  loadRetailerOrders,
  needsGatewayPaymentVerification,
  orderMerchandiseTotal,
  orderTotal,
  queryPaymentStatus,
  requestCodDeliveryRefund,
  requestOrderCancellation,
  type RetailerOrder,
} from "./retailer-orders-api.ts";
import { needsDeliveryConfirmation } from "./retailer-dashboard-api.ts";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";

type RetailerOrdersProps = {
  loadOrders?: (retailerId: string) => Promise<RetailerOrder[]>;
  loadCart?: (userId: string) => Promise<number>;
};

type Notice = { message: string; state: NoticeState } | null;

type OrderFilter = "action" | "active" | "delivered" | "cancelled" | "all";

const ORDER_FILTERS: { id: OrderFilter; label: string }[] = [
  { id: "action", label: "Needs action" },
  { id: "active", label: "Active" },
  { id: "delivered", label: "Delivered" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" },
];

function parseOrderFilter(value: string | null): OrderFilter {
  if (
    value === "action" ||
    value === "active" ||
    value === "delivered" ||
    value === "cancelled" ||
    value === "all"
  ) {
    return value;
  }
  return "all";
}

function needsAction(order: RetailerOrder): boolean {
  return (
    needsDeliveryConfirmation(order) ||
    needsGatewayPaymentVerification(order) ||
    order.cancel_requested ||
    canRequestCodDeliveryRefund(order)
  );
}

function isActive(order: RetailerOrder): boolean {
  return order.status === "pending" || order.status === "confirmed" || order.status === "shipped";
}

function matchesFilter(order: RetailerOrder, filter: OrderFilter): boolean {
  if (filter === "all") return true;
  if (filter === "action") return needsAction(order);
  if (filter === "active") return isActive(order);
  if (filter === "delivered") return order.status === "delivered";
  if (filter === "cancelled") return order.status === "cancelled";
  return true;
}

function CancelAction({
  order,
  disabled,
  onCancel,
  onVerifyDelivery,
  onRequestDeliveryRefund,
}: {
  order: RetailerOrder;
  disabled: boolean;
  onCancel: (order: RetailerOrder) => void;
  onVerifyDelivery: (order: RetailerOrder) => void;
  onRequestDeliveryRefund: (order: RetailerOrder) => void;
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
          {order.payment_method === "cod" ? "Delivery refund pending" : "Manual refund pending"} ·{" "}
          {formatPrice(order.refund_amount)}
        </p>
      );
    }
    if (order.manual_refund_status === "completed") {
      return (
        <p className="text-sm text-muted-foreground">
          {order.payment_method === "cod" ? "Delivery refund completed" : "Refund completed"} ·{" "}
          {formatPrice(order.refund_amount)}
        </p>
      );
    }
    if (canRequestCodDeliveryRefund(order)) {
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onRequestDeliveryRefund(order)}
        >
          <RefreshCw data-icon="inline-start" />
          Request delivery refund
        </Button>
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
        <RouterLink to="/retailer/complaints" search={{ order: order.id }}>
          <MessageSquare data-icon="inline-start" />
          Contact support for cancellation or refund
        </RouterLink>
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
  const searchStr = useRouterState({ select: (routerState) => routerState.location.searchStr });
  const filter = parseOrderFilter(searchParam(searchStr, "filter"));
  const focusOrderId = searchParam(searchStr, "order");
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

  useEffect(() => {
    if (!focusOrderId || !orders) return;
    const el = document.getElementById(`order-${focusOrderId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusOrderId, orders]);

  const counts = useMemo(() => {
    const list = orders ?? [];
    return {
      action: list.filter(needsAction).length,
      active: list.filter(isActive).length,
      delivered: list.filter((order) => order.status === "delivered").length,
      cancelled: list.filter((order) => order.status === "cancelled").length,
      all: list.length,
    };
  }, [orders]);

  const filtered = useMemo(
    () => (orders ? orders.filter((order) => matchesFilter(order, filter)) : []),
    [orders, filter],
  );

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

  const setFilter = (value: OrderFilter) => {
    void navigate({
      to: "/retailer/orders",
      search: (value === "all" ? {} : { filter: value }) as never,
      replace: true,
    });
  };

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
          if (order.payment_method === "cod") {
            updateOrder(order.id, { delivery_payment_status: "paid" });
          } else {
            updateOrder(order.id, {
              payment_status: result,
              delivery_payment_status: "paid",
            });
          }
        } else if (order.payment_method === "cod") {
          updateOrder(order.id, { delivery_payment_status: result });
        } else {
          updateOrder(order.id, {
            payment_status: result,
            delivery_payment_status: result,
          });
        }
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
    const paidOnline = order.payment_method === "online" && order.payment_status === "paid";
    const prepaidDelivery =
      order.payment_method === "cod" && order.delivery_payment_status === "paid";
    const refundHint = paidOnline
      ? " and manually refund the eligible paid amount (a platform retention may be deducted)"
      : prepaidDelivery
        ? ". Prepaid delivery is not refunded automatically when you cancel"
        : "";
    const message = `Request cancellation of order #${shortId(order.id)}? The admin team will review it${refundHint}.`;
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

  const onRequestDeliveryRefund = (order: RetailerOrder) => {
    if (!canRequestCodDeliveryRefund(order)) return;
    if (
      !window.confirm(
        `Request a refund of the ${formatPrice(order.delivery_charge)} prepaid delivery charge for order #${shortId(order.id)}?`,
      )
    ) {
      return;
    }

    setBusyId(order.id);
    void requestCodDeliveryRefund(order.id)
      .then((result) => {
        updateOrder(order.id, {
          manual_refund_status: "pending",
          refund_amount: result.refundAmount,
        });
        setNotice({
          message: `Delivery refund of ${formatPrice(result.refundAmount)} was requested for order #${shortId(order.id)}.`,
          state: "info",
        });
      })
      .catch((refundError: unknown) => {
        setNotice({
          message:
            refundError instanceof Error
              ? refundError.message
              : "The delivery refund request could not be submitted.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  return (
    <RetailerWorkspaceShell
      section="orders"
      userName={userName}
      userEmail={state.profile.email}
      cartCount={cartCount}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Order history"
        title="My orders."
        copy="Track deliveries, confirm receipt, and manage cancellations in one place."
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

      {orders ? (
        orders.length ? (
          <div className="flex flex-col gap-4">
            <Tabs value={filter} onValueChange={(value) => setFilter(parseOrderFilter(value))}>
              <TabsList variant="line" className="h-auto w-full flex-wrap justify-start">
                {ORDER_FILTERS.map((item) => (
                  <TabsTrigger key={item.id} value={item.id}>
                    {item.label}
                    <Badge variant="secondary" className="ml-2">
                      {counts[item.id]}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {filtered.length ? (
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
                    {filtered.map((order) => (
                      <OrderRow
                        key={order.id}
                        rowId={`order-${order.id}`}
                        colSpan={6}
                        defaultOpen={focusOrderId === order.id}
                        highlight={focusOrderId === order.id}
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
                                {needsAction(order) ? (
                                  <Badge variant="outline">Needs action</Badge>
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
                            <dl className="grid grid-cols-2 gap-2 text-sm sm:max-w-sm">
                              <dt className="text-muted-foreground">Subtotal</dt>
                              <dd className="text-right tabular-nums">
                                {formatPrice(orderMerchandiseTotal(order))}
                              </dd>
                              <dt className="text-muted-foreground">Delivery</dt>
                              <dd className="text-right tabular-nums">
                                {formatPrice(order.delivery_charge)}
                              </dd>
                              <dt className="font-medium">Total</dt>
                              <dd className="text-right font-medium tabular-nums">
                                {formatPrice(orderTotal(order))}
                              </dd>
                              {order.payment_method === "cod" ? (
                                <>
                                  <dt className="text-muted-foreground">Delivery payment</dt>
                                  <dd className="text-right">
                                    {order.delivery_payment_status === "paid"
                                      ? "Paid online"
                                      : order.delivery_payment_status === "failed"
                                        ? "Failed"
                                        : order.delivery_payment_status === "cancelled"
                                          ? "Cancelled"
                                          : "Unpaid"}
                                  </dd>
                                  <dt className="text-muted-foreground">Products</dt>
                                  <dd className="text-right">
                                    {order.payment_status === "paid"
                                      ? "Cash collected"
                                      : "Pay in cash on arrival"}
                                  </dd>
                                </>
                              ) : null}
                            </dl>
                            <DeliveryDetails
                              phone={order.delivery_phone}
                              address={order.delivery_address}
                              city={order.delivery_city}
                              postcode={order.delivery_postcode}
                            />
                            {order.status === "shipped" ||
                            order.status === "delivered" ||
                            order.shipment ? (
                              <div className="flex flex-col gap-2">
                                <p className="text-sm font-medium">Shipment tracking</p>
                                <OrderTrackingPanel shipment={order.shipment} />
                              </div>
                            ) : null}
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
                              {needsGatewayPaymentVerification(order) ? (
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
                                onRequestDeliveryRefund={onRequestDeliveryRefund}
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
                icon={Package}
                title="No orders in this filter"
                copy="Try another status tab, or place a new order."
                action={
                  <Button asChild>
                    <RouterLink to="/retailer/catalog">Place order</RouterLink>
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          <EmptyState
            icon={Package}
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
    </RetailerWorkspaceShell>
  );
}
