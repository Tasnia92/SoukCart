import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  MessageSquare,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
  TriangleAlert,
  Truck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  SearchToolbar,
  TableShell,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import {
  DeliveryDetails,
  OrderRow,
  PaymentBadge,
  StatusBadge,
  shortId,
} from "../orders/order-presentation.tsx";
import { searchParam } from "../workspace/search.ts";
import { formatDate, formatPrice } from "../workspace/format.ts";
import {
  canCancelOrder,
  canRequestCodDeliveryRefund,
  clearCart,
  confirmOrderDelivery,
  deliveryAgeDays,
  filterOrdersByQuery,
  loadCartCount,
  loadRetailerOrders,
  needsGatewayPaymentVerification,
  ORDER_SORTS,
  orderMerchandiseTotal,
  orderTotal,
  packageStatusLabel,
  parseOrderSort,
  primaryShipment,
  queryPaymentStatus,
  requestCodDeliveryRefund,
  requestOrderCancellation,
  shipmentStatusLabel,
  sortOrders,
  type OrderSort,
  type RetailerOrder,
} from "./retailer-orders-api.ts";
import { buildShipmentCards, needsDeliveryConfirmation } from "./retailer-dashboard-api.ts";
import { MiniTimeline, TrackingLine, placedAgoLabel } from "./Shipments.tsx";
import { useRetailerOrderChanges } from "./retailer-realtime.ts";
import { reorderOrderItems } from "./retailer-cart-api.ts";
import { applyReconciliation, reconcileRetailerPayments } from "./retailer-overview-api.ts";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";

type RetailerOrdersProps = {
  loadOrders?: (retailerId: string) => Promise<RetailerOrder[]>;
  loadCart?: (userId: string) => Promise<number>;
};

type Notice = { message: string; state: NoticeState } | null;

/** The two destructive moves the retailer confirms through the AlertDialog. */
type ConfirmAction =
  | { kind: "verify-delivery"; order: RetailerOrder }
  | { kind: "cancel"; order: RetailerOrder };

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

/** Refund-policy wording for the cancellation dialog, stated up front. */
function cancelHint(order: RetailerOrder): string {
  const paidOnline = order.payment_method === "online" && order.payment_status === "paid";
  const prepaidDelivery =
    order.payment_method === "cod" && order.delivery_payment_status === "paid";
  if (paidOnline) {
    return "Paid merchandise is manually refunded; prepaid delivery is kept and there is no platform charge.";
  }
  if (prepaidDelivery) return "Prepaid delivery is not refunded when you cancel.";
  return "";
}

function matchesFilter(order: RetailerOrder, filter: OrderFilter): boolean {
  if (filter === "all") return true;
  if (filter === "action") return needsAction(order);
  if (filter === "active") return isActive(order);
  if (filter === "delivered") return order.status === "delivered";
  if (filter === "cancelled") return order.status === "cancelled";
  return true;
}

/** "Rice 25kg, Sugar 1kg +2 more" preview text for the items cell. */
function itemPreview(order: RetailerOrder): { text: string; extra: number } {
  const names = order.items.map((item) => item.product_name);
  const shown = names.slice(0, 2).join(", ");
  return { text: shown, extra: Math.max(names.length - 2, 0) };
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
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<OrderSort>("newest");

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

        // Payment reconciliation runs after the page has painted, so a slow
        // gateway can no longer hold up the list. Same pattern as the overview.
        void reconcileRetailerPayments(retailerId, nextOrders)
          .then(({ updates, cartCleared }) => {
            if (!current || (!updates.length && !cartCleared)) return;
            setOrders((previous) => (previous ? applyReconciliation(previous, updates) : previous));
            if (cartCleared) setCartCount(0);
            const settled = updates.some(
              (update) =>
                update.payment_status === "paid" || update.delivery_payment_status === "paid",
            );
            if (settled) {
              setNotice({
                message: "A payment went through while you were away.",
                state: "success",
              });
            }
          })
          .catch(() => {
            // Reconciliation is a background correction; the shown data stays valid.
          });
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

  const shipmentCards = useMemo(() => buildShipmentCards(orders ?? []), [orders]);

  const inFilter = useMemo(
    () => (orders ?? []).filter((order) => matchesFilter(order, filter)),
    [orders, filter],
  );

  const visible = useMemo(
    () => sortOrders(filterOrdersByQuery(inFilter, query), sort),
    [inFilter, query, sort],
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
    setConfirmAction({ kind: "verify-delivery", order });
  };

  const runVerifyDelivery = (order: RetailerOrder) => {
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
    setConfirmAction({ kind: "cancel", order });
  };

  const runCancel = (order: RetailerOrder) => {
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

  const onConfirmDialog = () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (!action) return;
    if (action.kind === "verify-delivery") runVerifyDelivery(action.order);
    else runCancel(action.order);
  };

  const onReorder = (order: RetailerOrder) => {
    setBusyId(order.id);
    void reorderOrderItems(
      retailerId,
      order.items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
    )
      .then(async (outcome) => {
        if (!outcome.lines) {
          setNotice({
            message:
              "None of these items are orderable right now — the catalog or stock may have changed.",
            state: "info",
          });
          return;
        }
        setCartCount(await loadCart(retailerId));
        const unavailable = outcome.unavailable
          ? ` ${outcome.unavailable} item${outcome.unavailable === 1 ? " is" : "s are"} no longer orderable.`
          : "";
        setNotice({
          message: `Added ${outcome.lines} item${outcome.lines === 1 ? "" : "s"} (${outcome.units} units) to your cart.${unavailable}`,
          state: "success",
        });
      })
      .catch((reorderError: unknown) => {
        setNotice({
          message:
            reorderError instanceof Error
              ? reorderError.message
              : "The items could not be added to your cart.",
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
      inTransitCount={orders ? shipmentCards.length : undefined}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Ordering & delivery"
        title="Orders."
        copy="Track every shipment to your door, confirm deliveries, and manage cancellations."
        actions={
          <>
            {shipmentCards.length ? (
              <Button asChild variant="outline">
                <RouterLink to="/retailer/tracking">
                  <Truck data-icon="inline-start" />
                  Track {shipmentCards.length} in transit
                </RouterLink>
              </Button>
            ) : null}
            <Button asChild>
              <RouterLink to="/retailer">
                <ShoppingBag data-icon="inline-start" />
                Place order
              </RouterLink>
            </Button>
          </>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />

      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        {confirmAction ? (
          <AlertDialogContent>
            {confirmAction.kind === "verify-delivery" ? (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Verify delivery of order #{shortId(confirmAction.order.id)}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Confirm the parcel arrived in good condition. This closes the order — any issue
                    raised after that goes through the Help Center.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Not yet</AlertDialogCancel>
                  <AlertDialogAction onClick={onConfirmDialog}>Verify delivery</AlertDialogAction>
                </AlertDialogFooter>
              </>
            ) : (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Request cancellation of order #{shortId(confirmAction.order.id)}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {cancelHint(confirmAction.order)} The admin team reviews every cancellation
                    before anything is cancelled.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep order</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={onConfirmDialog}>
                    Request cancellation
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            )}
          </AlertDialogContent>
        ) : null}
      </AlertDialog>

      {orders ? (
        orders.length ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <SearchToolbar
                label="Search orders"
                placeholder="Search orders, products, address…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                result={
                  query
                    ? `${visible.length} of ${inFilter.length} orders`
                    : `${inFilter.length} orders`
                }
              />
              <div className="flex shrink-0 flex-col gap-1">
                <span className="text-xs text-muted-foreground">Sort</span>
                <Select value={sort} onValueChange={(value) => setSort(parseOrderSort(value))}>
                  <SelectTrigger size="sm" aria-label="Sort orders" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_SORTS.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

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

            {visible.length ? (
              <TableShell>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>
                        <span className="sr-only">Shortcuts</span>
                      </TableHead>
                      <TableHead>
                        <span className="sr-only">Details</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((order) => {
                      const shipment = primaryShipment(order);
                      const preview = itemPreview(order);
                      return (
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
                                <div className="min-w-0">
                                  <strong className="font-medium">#{shortId(order.id)}</strong>
                                  <p
                                    className="text-xs text-muted-foreground"
                                    title={placedAgoLabel(deliveryAgeDays(order))}
                                  >
                                    {formatDate(order.created_at)}
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="min-w-0">
                                  <p className="text-sm">
                                    {order.items.reduce((sum, item) => sum + item.quantity, 0)}{" "}
                                    {order.items.length === 1 ? "item" : "items"}
                                  </p>
                                  <p className="max-w-56 truncate text-xs text-muted-foreground">
                                    {preview.text}
                                    {preview.extra > 0 ? ` +${preview.extra} more` : ""}
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <strong>{formatPrice(orderTotal(order))}</strong>
                              </TableCell>
                              <TableCell>
                                <div className="flex min-w-40 flex-col gap-1.5">
                                  <div className="flex items-center gap-2">
                                    <MiniTimeline status={order.status} />
                                    <StatusBadge status={order.status} />
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <PaymentBadge
                                      paymentStatus={order.payment_status}
                                      paymentMethod={order.payment_method}
                                    />
                                    {order.delivery_verified_at ? (
                                      <Badge variant="secondary">Verified</Badge>
                                    ) : null}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="w-28">
                                <div className="flex items-center justify-end gap-1">
                                  {isActive(order) ? (
                                    <Button
                                      asChild
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Track order #${shortId(order.id)}`}
                                    >
                                      <RouterLink
                                        to="/retailer/tracking"
                                        search={{ order: order.id }}
                                      >
                                        <Truck />
                                      </RouterLink>
                                    </Button>
                                  ) : null}
                                  {order.payment_status === "paid" ? (
                                    <Button
                                      asChild
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Download invoice for order #${shortId(order.id)}`}
                                    >
                                      <RouterLink
                                        to="/retailer/orders/$orderId/invoice"
                                        params={{ orderId: order.id }}
                                      >
                                        <Download />
                                      </RouterLink>
                                    </Button>
                                  ) : null}
                                  {needsAction(order) ? (
                                    <span
                                      className="flex items-center text-amber-600 dark:text-amber-400"
                                      title="This order needs your attention"
                                    >
                                      <TriangleAlert className="size-4" aria-hidden="true" />
                                      <span className="sr-only">Needs action</span>
                                    </span>
                                  ) : null}
                                </div>
                              </TableCell>
                            </>
                          }
                          detail={
                            <div className="flex flex-col gap-4">
                              <div className="flex flex-col gap-4">
                                {(order.packages.length
                                  ? order.packages
                                  : [
                                      {
                                        supplier_id: "all",
                                        status: "pending" as const,
                                        decline_reason: null,
                                      },
                                    ]
                                ).map((pkg) => {
                                  const items = order.packages.length
                                    ? order.items.filter(
                                        (item) => item.seller_id === pkg.supplier_id,
                                      )
                                    : order.items;
                                  if (!items.length && order.packages.length) return null;
                                  return (
                                    <div className="flex flex-col gap-2" key={pkg.supplier_id}>
                                      {order.packages.length > 1 || pkg.status === "declined" ? (
                                        <p className="text-xs font-medium text-muted-foreground">
                                          {packageStatusLabel(pkg.status)}
                                          {pkg.decline_reason ? ` · ${pkg.decline_reason}` : ""}
                                        </p>
                                      ) : null}
                                      <ul className="flex flex-col gap-2">
                                        {items.map((item) => (
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
                                    </div>
                                  );
                                })}
                              </div>
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
                              {shipment && order.status !== "cancelled" ? (
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Truck
                                      className="size-4 shrink-0 text-muted-foreground"
                                      aria-hidden="true"
                                    />
                                    <TrackingLine shipment={shipment} />
                                    <Badge variant="secondary">
                                      {shipmentStatusLabel(shipment.status)}
                                    </Badge>
                                  </div>
                                  {isActive(order) ? (
                                    <Button
                                      asChild
                                      variant="outline"
                                      size="sm"
                                      className="self-start"
                                    >
                                      <RouterLink
                                        to="/retailer/tracking"
                                        search={{ order: order.id }}
                                      >
                                        <Truck data-icon="inline-start" />
                                        Open live tracking
                                      </RouterLink>
                                    </Button>
                                  ) : null}
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
                                    {formatPrice(order.refund_amount)} refund
                                    {order.platform_charge > 0
                                      ? ` · platform charge ${formatPrice(order.platform_charge)}`
                                      : ""}
                                    {order.delivery_charge > 0
                                      ? ` · prepaid delivery ${formatPrice(order.delivery_charge)} retained`
                                      : ""}
                                  </AlertDescription>
                                </Alert>
                              ) : null}
                              <div className="flex flex-wrap items-center gap-2">
                                {order.status === "delivered" ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={busyId === order.id}
                                    onClick={() => onReorder(order)}
                                  >
                                    <ShoppingBag data-icon="inline-start" />
                                    Reorder items
                                  </Button>
                                ) : null}
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
                      );
                    })}
                  </TableBody>
                </Table>
              </TableShell>
            ) : query ? (
              <EmptyState
                icon={Search}
                title="No matching orders"
                copy="Try a different search term, or clear it to see the whole list."
                action={
                  <Button type="button" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Package}
                title="No orders in this filter"
                copy="Try another status tab, or place a new order."
                action={
                  <Button asChild>
                    <RouterLink to="/retailer">Place order</RouterLink>
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
                <RouterLink to="/retailer">Place order</RouterLink>
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
