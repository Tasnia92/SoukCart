import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  Check,
  CheckCheck,
  ChevronDown,
  Download,
  Package,
  RefreshCw,
  Search,
  Truck,
  type LucideIcon,
} from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  SearchToolbar,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { useTableChanges } from "../../workspace-realtime.ts";
import { DeliveryStatusCard, deliveryActionLabel } from "../orders/DeliveryStatus.tsx";
import {
  DeliveryDetails,
  PaymentBadge,
  shortId,
  StatusBadge,
} from "../orders/order-presentation.tsx";
import { formatDate, formatPrice, formatUpdatedAt } from "../workspace/format.ts";
import { searchParam } from "../workspace/search.ts";
import { SupplierWorkspaceShell } from "./supplier-shared.tsx";
import {
  approveSupplierCancellation,
  canConfirmOrder,
  canDeclineOrderItems,
  canDeliverOrder,
  canDispatchOrder,
  canMarkOutForDelivery,
  canSupplierCancel,
  cancelSupplierOrder,
  declineSupplierItems,
  filterSupplierOrders,
  hasRetailerCancellationRequest,
  isDeliveryInitiated,
  loadSupplierOrders,
  rejectSupplierCancellation,
  setSupplierOrderStatus,
  type SupplierDeliveryAction,
  type SupplierOrder,
} from "./supplier-orders-api.ts";
import { requestSellerReturn } from "./supplier-returns-api.ts";

type SupplierOrdersProps = {
  loadOrders?: () => Promise<SupplierOrder[]>;
};

type Notice = { message: string; state: NoticeState } | null;
type OrderFilter =
  | "action"
  | "awaiting-payment"
  | "in-progress"
  | "delivered"
  | "cancelled"
  | "all";
type OrderSort = "oldest" | "newest" | "value" | "city";
type FulfillAction = SupplierDeliveryAction;
type CancelDecision = { order: SupplierOrder; approve: boolean };

const ORDER_FILTERS = new Set<OrderFilter>([
  "action",
  "awaiting-payment",
  "in-progress",
  "delivered",
  "cancelled",
  "all",
]);

/** Legacy filter values still used by deep links; canonicalize onto the six options. */
const FILTER_ALIASES: Record<string, OrderFilter> = {
  "to-confirm": "action",
  "cancellation-requested": "action",
  "to-ship": "in-progress",
  "in-transit": "in-progress",
};

const ORDERS_LIVE_TABLES = ["orders"] as const;

function parseOrderFilter(value: string | null): OrderFilter {
  if (value && ORDER_FILTERS.has(value as OrderFilter)) return value as OrderFilter;
  if (value && value in FILTER_ALIASES) return FILTER_ALIASES[value];
  return "action";
}

function needsAction(order: SupplierOrder): boolean {
  return (
    canConfirmOrder(order) ||
    canDeclineOrderItems(order) ||
    canDispatchOrder(order) ||
    canMarkOutForDelivery(order) ||
    canDeliverOrder(order) ||
    hasRetailerCancellationRequest(order)
  );
}

function isAwaitingPayment(order: SupplierOrder): boolean {
  return (
    order.status === "pending" && order.payment_method !== "cod" && order.payment_status !== "paid"
  );
}

function canOpenReturn(order: SupplierOrder): boolean {
  return order.status === "delivered" && !order.cancel_requested;
}

/** Confirmed (waiting on the admin gate) or already moving toward the retailer. */
function isInProgress(order: SupplierOrder): boolean {
  if (order.cancel_requested) return false;
  if (order.status === "cancelled" || order.status === "delivered") return false;
  return order.package_status === "confirmed" || order.status === "shipped";
}

function matchesFilter(order: SupplierOrder, filter: OrderFilter): boolean {
  if (filter === "all") return true;
  if (filter === "action") return needsAction(order);
  if (filter === "awaiting-payment") return isAwaitingPayment(order);
  if (filter === "in-progress") return isInProgress(order);
  if (filter === "delivered") return order.status === "delivered";
  return order.status === "cancelled";
}

/** Hours elapsed since created_at, floored at zero to absorb clock skew. */
function waitingHours(createdAt: string, now = Date.now()): number {
  return Math.floor(Math.max(0, now - new Date(createdAt).getTime()) / 3_600_000);
}

/** Relative wait label from created_at: hours under 48h, otherwise days. */
function formatWaitingLabel(createdAt: string, now = Date.now()): string {
  const hours = waitingHours(createdAt, now);
  if (hours < 48) {
    if (hours < 1) return "Waiting under an hour";
    if (hours === 1) return "Waiting 1 hour";
    return `Waiting ${hours} hours`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "Waiting 1 day" : `Waiting ${days} days`;
}

function sortOrders(orders: SupplierOrder[], sort: OrderSort): SupplierOrder[] {
  const next = [...orders];
  if (sort === "oldest") {
    next.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } else if (sort === "newest") {
    next.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } else if (sort === "value") {
    next.sort((a, b) => b.supplier_total - a.supplier_total);
  } else {
    next.sort((a, b) => (a.delivery_city ?? "").localeCompare(b.delivery_city ?? ""));
  }
  return next;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function exportOrdersCsv(orders: readonly SupplierOrder[]): void {
  const header = ["id", "date", "retailer", "city", "status", "payment", "total"];
  const lines = [
    header.join(","),
    ...orders.map((order) =>
      [
        order.id,
        order.created_at,
        order.retailer_name,
        order.delivery_city ?? "",
        order.status,
        `${order.payment_method}/${order.payment_status}`,
        String(order.supplier_total),
      ]
        .map((cell) => csvEscape(cell))
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `supplier-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function deliveryProgress(order: SupplierOrder) {
  return {
    deliveryInitiated: isDeliveryInitiated(order),
    parcelStatus: order.shipment_status,
  };
}

/** The one next step this supplier can take right now, or null when blocked. */
function primaryAction(order: SupplierOrder): FulfillAction | null {
  if (order.status === "cancelled") return null;
  if (hasRetailerCancellationRequest(order)) return null;
  if (order.cancel_requested) return null;
  if (canConfirmOrder(order)) return "confirmed";
  if (canDispatchOrder(order)) return "dispatched";
  if (canMarkOutForDelivery(order)) return "out_for_delivery";
  if (canDeliverOrder(order)) return "delivered";
  return null;
}

const ACTION_META: Record<FulfillAction, { icon: LucideIcon }> = {
  confirmed: { icon: Check },
  dispatched: { icon: Truck },
  out_for_delivery: { icon: Truck },
  delivered: { icon: CheckCheck },
};

/** Short label for the collapsed row when there is no button to show. */
function headerHint(order: SupplierOrder): string | null {
  if (order.status === "cancelled") return "Cancelled";
  if (order.status === "delivered") {
    return order.delivery_verified_at ? "Completed" : "Delivered";
  }
  if (order.delivery_payment_status !== "paid") return "Awaiting delivery payment";
  if (order.status === "pending") return "Awaiting payment";
  if (order.package_status === "confirmed" && !isDeliveryInitiated(order)) {
    return "Awaiting delivery start";
  }
  if (order.package_status === "declined") return "Items declined";
  return null;
}

/** Full-sentence explanation shown inside the expanded order. */
function orderExplanation(order: SupplierOrder): string | null {
  if (order.status === "cancelled") {
    return order.manual_refund_status === "pending"
      ? "This order was cancelled. A manual refund is pending."
      : "This order was cancelled.";
  }
  if (hasRetailerCancellationRequest(order)) {
    return order.shipment_status === "out_for_delivery"
      ? "The retailer asked to cancel this order. The parcel is out for delivery: approving cancels it and refunds the merchandise, but the delivery charge is kept."
      : "The retailer asked to cancel this order. Approving cancels it and refunds everything the retailer paid in advance, including the delivery charge.";
  }
  if (order.cancel_requested) {
    return "You requested cancellation of this order. Confirm below to cancel it now.";
  }
  if (order.delivery_payment_status !== "paid") {
    return "Waiting for the retailer to pay the delivery charge before fulfillment.";
  }
  if (order.status === "delivered" && order.delivery_verified_at) {
    return "Delivery verified · the order is closed.";
  }
  if (order.status === "pending" && !canConfirmOrder(order)) {
    return "Waiting for online payment before fulfillment.";
  }
  if (order.package_status === "confirmed" && !isDeliveryInitiated(order)) {
    return "Waiting for admin to initiate delivery. Have the parcel ready to hand over.";
  }
  if (order.package_status === "declined") {
    return `You declined these items${order.decline_reason ? ` · ${order.decline_reason}` : ""}`;
  }
  return null;
}

/**
 * One order as a collapsible row. The collapsed header always shows the next
 * action button, so the queue can be worked without expanding anything.
 */
function OrderCard({
  order,
  waitingLabel,
  urgent,
  busy,
  open,
  onToggle,
  onFulfill,
  onCancel,
  onDecline,
  onReturn,
  onDecideCancellation,
}: {
  order: SupplierOrder;
  waitingLabel: string;
  urgent: boolean;
  busy: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  onFulfill: (order: SupplierOrder, action: FulfillAction) => void;
  onCancel: (order: SupplierOrder) => void;
  onDecline: (order: SupplierOrder) => void;
  onReturn: (order: SupplierOrder) => void;
  onDecideCancellation: (order: SupplierOrder, approve: boolean) => void;
}) {
  const action = primaryAction(order);
  const explanation = orderExplanation(order);
  const hint = action ? null : headerHint(order);
  const decisionRequest = hasRetailerCancellationRequest(order);
  const units = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const ActionIcon = action ? ACTION_META[action].icon : null;

  return (
    <Collapsible
      open={open}
      onOpenChange={onToggle}
      className="overflow-hidden rounded-xl border border-border/70 bg-card"
    >
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
            aria-label={`${open ? "Hide" : "Show"} details for order #${shortId(order.id)}`}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">#{shortId(order.id)}</span>
                <StatusBadge status={order.status} />
                <span
                  className={cn(
                    "text-xs",
                    urgent ? "font-medium text-destructive" : "text-muted-foreground",
                  )}
                >
                  {waitingLabel}
                </span>
                {decisionRequest ? (
                  <Badge variant="destructive">Cancellation requested</Badge>
                ) : null}
                {order.package_status === "declined" ? (
                  <Badge variant="outline">Items declined</Badge>
                ) : null}
              </span>
              <span className="truncate text-sm text-muted-foreground">
                {order.retailer_name} · {units} {units === 1 ? "unit" : "units"} · placed{" "}
                {formatDate(order.created_at)}
              </span>
            </span>
          </button>
        </CollapsibleTrigger>
        <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
          <span className="flex items-center gap-2">
            <span className="font-semibold tabular-nums">{formatPrice(order.supplier_total)}</span>
            <PaymentBadge
              paymentStatus={order.payment_status}
              paymentMethod={order.payment_method}
            />
          </span>
          <span className="flex items-center gap-2">
            {decisionRequest ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={busy}
                  onClick={() => onDecideCancellation(order, false)}
                >
                  Reject
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  type="button"
                  disabled={busy}
                  onClick={() => onDecideCancellation(order, true)}
                >
                  Approve &amp; cancel
                </Button>
              </>
            ) : order.cancel_requested ? (
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={busy}
                onClick={() => onCancel(order)}
              >
                <Ban data-icon="inline-start" />
                Cancel order
              </Button>
            ) : action && ActionIcon ? (
              <Button
                size="sm"
                type="button"
                disabled={busy}
                onClick={() => onFulfill(order, action)}
              >
                {busy ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <ActionIcon data-icon="inline-start" />
                )}
                {deliveryActionLabel(action)}
              </Button>
            ) : hint ? (
              <span className="text-sm text-muted-foreground">{hint}</span>
            ) : null}
          </span>
        </div>
      </div>
      <CollapsibleContent>
        <div className="flex flex-col gap-4 border-t border-border/70 bg-muted/40 p-4">
          {explanation ? <p className="text-sm text-muted-foreground">{explanation}</p> : null}
          <div className="flex flex-col gap-2">
            {order.items.map((item) => (
              <div className="flex items-center justify-between gap-4 text-sm" key={item.id}>
                <span className="min-w-0 truncate font-medium">{item.product_name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {item.quantity} × {formatPrice(item.unit_price)}
                </span>
                <span className="shrink-0 font-medium">{formatPrice(item.line_total)}</span>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t pt-2 text-sm">
              <span className="font-medium">Your total</span>
              <span className="font-semibold">{formatPrice(order.supplier_total)}</span>
            </div>
          </div>
          <DeliveryDetails
            phone={order.delivery_phone}
            address={order.delivery_address}
            city={order.delivery_city}
            postcode={order.delivery_postcode}
          />
          {order.notes ? (
            <p className="text-sm">
              <span className="font-medium">Notes: </span>
              {order.notes}
            </p>
          ) : null}
          {order.cancellation_reason ? (
            <p className="text-sm">
              <span className="font-medium">Cancellation reason: </span>
              {order.cancellation_reason}
            </p>
          ) : null}
          <DeliveryStatusCard
            status={order.status}
            audience="supplier"
            progress={deliveryProgress(order)}
          />
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Manage
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {canDeclineOrderItems(order) ? (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={busy}
                  onClick={() => onDecline(order)}
                >
                  Decline items
                </Button>
              ) : null}
              {canOpenReturn(order) ? (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={busy}
                  onClick={() => onReturn(order)}
                >
                  Open return
                </Button>
              ) : null}
              {canSupplierCancel(order) ? (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={busy}
                  onClick={() => onCancel(order)}
                >
                  <Ban data-icon="inline-start" />
                  Cancel order
                </Button>
              ) : null}
              {order.cancel_requested ? (
                <Button size="sm" type="button" disabled={busy} onClick={() => onCancel(order)}>
                  <Ban data-icon="inline-start" />
                  Confirm cancellation
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SupplierOrders({ loadOrders = loadSupplierOrders }: SupplierOrdersProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/orders" });
  const searchStr = useRouterState({ select: (routerState) => routerState.location.searchStr });
  const filter = parseOrderFilter(searchParam(searchStr, "filter"));
  const [orders, setOrders] = useState<SupplierOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [searchTerm, setSearchTerm] = useState("");
  const [sort, setSort] = useState<OrderSort>("oldest");
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [fulfillTarget, setFulfillTarget] = useState<{
    order: SupplierOrder;
    action: FulfillAction;
  } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SupplierOrder | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelInvalid, setCancelInvalid] = useState(false);
  const [cancelDecision, setCancelDecision] = useState<CancelDecision | null>(null);
  const [declineTarget, setDeclineTarget] = useState<SupplierOrder | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [declineInvalid, setDeclineInvalid] = useState(false);
  const [returnTarget, setReturnTarget] = useState<SupplierOrder | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [returnInvalid, setReturnInvalid] = useState(false);

  const isSeller = state.status === "seller";
  const retry = useCallback(() => setLoadVersion((version) => version + 1), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isSeller) return;
    let current = true;
    setError(null);
    setRefreshing(true);

    void loadOrders()
      .then((nextOrders) => {
        if (current) {
          setOrders(nextOrders);
          setUpdatedAt(Date.now());
          setRefreshing(false);
        }
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
          setRefreshing(false);
        }
      });

    return () => {
      current = false;
    };
  }, [isSeller, loadOrders, loadVersion]);

  useTableChanges({
    enabled: Boolean(orders),
    tables: ORDERS_LIVE_TABLES,
    onChange: retry,
    coalesceMs: 1500,
  });

  const counts = useMemo(() => {
    const list = orders ?? [];
    return {
      all: list.length,
      action: list.filter(needsAction).length,
      awaitingPayment: list.filter(isAwaitingPayment).length,
      inProgress: list.filter(isInProgress).length,
      delivered: list.filter((order) => order.status === "delivered").length,
      cancelled: list.filter((order) => order.status === "cancelled").length,
    };
  }, [orders]);

  const searched = useMemo(
    () => (orders ? filterSupplierOrders(orders, searchTerm, shortId) : []),
    [orders, searchTerm],
  );
  const filtered = useMemo(
    () =>
      sortOrders(
        searched.filter((order) => matchesFilter(order, filter)),
        sort,
      ),
    [searched, filter, sort],
  );

  if (state.status !== "seller") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const userName = state.profile.name || state.profile.email;

  const setFilter = (value: OrderFilter) => {
    void navigate({
      to: "/supplier/orders",
      search: value === "action" ? {} : { filter: value },
    } as never);
  };

  const toggleOpen = useCallback((orderId: string, next: boolean) => {
    setOpenIds((previous) => {
      const nextSet = new Set(previous);
      if (next) {
        nextSet.add(orderId);
      } else {
        nextSet.delete(orderId);
      }
      return nextSet;
    });
  }, []);

  const openFulfill = (order: SupplierOrder, action: FulfillAction) => {
    setFulfillTarget({ order, action });
  };
  const openCancel = (order: SupplierOrder) => {
    setCancelReason("");
    setCancelInvalid(false);
    setCancelTarget(order);
  };
  const openCancelDecision = (order: SupplierOrder, approve: boolean) => {
    setCancelDecision({ order, approve });
  };
  const openDecline = (order: SupplierOrder) => {
    setDeclineReason("");
    setDeclineInvalid(false);
    setDeclineTarget(order);
  };
  const openReturn = (order: SupplierOrder) => {
    setReturnReason("");
    setReturnInvalid(false);
    setReturnTarget(order);
  };

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

  const confirmFulfill = () => {
    const target = fulfillTarget;
    if (!target) return;
    const { order, action } = target;
    setFulfillTarget(null);
    setBusyId(order.id);
    void setSupplierOrderStatus(order.id, action)
      .then((status) => {
        setNotice({
          message:
            status === "confirmed"
              ? `Order #${shortId(order.id)} is confirmed. Delivery starts once admin initiates it.`
              : status === "dispatched"
                ? `Order #${shortId(order.id)} is dispatched. Mark it out for delivery when the courier takes it.`
                : status === "out_for_delivery"
                  ? `Order #${shortId(order.id)} is out for delivery. Mark it delivered once the retailer receives it.`
                  : `Order #${shortId(order.id)} is marked delivered. The retailer can verify the delivery.`,
          state: "success",
        });
        retry();
      })
      .catch((fulfillError: unknown) => {
        setNotice({
          message:
            fulfillError instanceof Error
              ? fulfillError.message
              : "The order status could not be updated.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const confirmCancelDecision = () => {
    const decision = cancelDecision;
    if (!decision) return;
    const { order, approve } = decision;
    setCancelDecision(null);
    setBusyId(order.id);
    if (approve) {
      void approveSupplierCancellation(order.id)
        .then((result) => {
          setNotice({
            message:
              result.manualRefundStatus === "pending" && result.refundAmount > 0
                ? `Order #${shortId(order.id)} was cancelled. A manual refund of ${formatPrice(result.refundAmount)} for merchandise is pending.`
                : `Order #${shortId(order.id)} was cancelled. The retailer was notified.`,
            state: "success",
          });
          retry();
        })
        .catch((decisionError: unknown) => {
          setNotice({
            message:
              decisionError instanceof Error
                ? decisionError.message
                : "The cancellation could not be approved.",
            state: "error",
          });
        })
        .finally(() => setBusyId(null));
      return;
    }
    void rejectSupplierCancellation(order.id)
      .then(() => {
        setNotice({
          message: `Cancellation request for order #${shortId(order.id)} was rejected. The order continues as normal.`,
          state: "info",
        });
        retry();
      })
      .catch((decisionError: unknown) => {
        setNotice({
          message:
            decisionError instanceof Error
              ? decisionError.message
              : "The cancellation request could not be rejected.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const confirmCancel = () => {
    const order = cancelTarget;
    if (!order) return;
    if (!cancelReason.trim()) {
      setCancelInvalid(true);
      return;
    }
    const reason = cancelReason.trim();
    setCancelTarget(null);
    setCancelReason("");
    setCancelInvalid(false);
    setBusyId(order.id);
    void cancelSupplierOrder(order.id, reason)
      .then(() => {
        setNotice({
          message: `Order #${shortId(order.id)} was cancelled. The retailer was notified and any advance-payment refund is queued for settlement.`,
          state: "info",
        });
        retry();
      })
      .catch((cancelError: unknown) => {
        setNotice({
          message:
            cancelError instanceof Error
              ? cancelError.message
              : "The order could not be cancelled.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const confirmDecline = () => {
    const order = declineTarget;
    if (!order) return;
    if (!declineReason.trim()) {
      setDeclineInvalid(true);
      return;
    }
    const reason = declineReason.trim();
    setDeclineTarget(null);
    setDeclineReason("");
    setDeclineInvalid(false);
    setBusyId(order.id);
    void declineSupplierItems(order.id, reason)
      .then(() => {
        setNotice({
          message: `You declined your items on order #${shortId(order.id)}. The retailer was notified.`,
          state: "info",
        });
        retry();
      })
      .catch((declineError: unknown) => {
        setNotice({
          message:
            declineError instanceof Error
              ? declineError.message
              : "These items could not be declined.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const confirmReturn = () => {
    const order = returnTarget;
    if (!order) return;
    if (returnReason.trim().length < 3) {
      setReturnInvalid(true);
      return;
    }
    const reason = returnReason.trim();
    setReturnTarget(null);
    setReturnReason("");
    setReturnInvalid(false);
    setBusyId(order.id);
    void requestSellerReturn(order.id, reason)
      .then(() => {
        setNotice({
          message: `Return opened for order #${shortId(order.id)}.`,
          state: "success",
        });
        retry();
      })
      .catch((returnError: unknown) => {
        setNotice({
          message:
            returnError instanceof Error ? returnError.message : "The return could not be opened.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  return (
    <SupplierWorkspaceShell
      section="orders"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Fulfillment"
        title="Orders"
        copy="Confirm orders you can fulfill and keep delivery status up to date. The next step for each order is one click away on its row."
        actions={
          <>
            {updatedAt ? (
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {refreshing ? "Refreshing…" : formatUpdatedAt(updatedAt, nowTick)}
              </span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Refresh"
              title="Refresh"
              disabled={refreshing}
              onClick={retry}
            >
              {refreshing ? <Spinner /> : <RefreshCw aria-hidden="true" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!filtered.length}
              onClick={() => exportOrdersCsv(filtered)}
            >
              <Download data-icon="inline-start" />
              Export CSV
            </Button>
          </>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {orders ? (
        orders.length ? (
          <div className="flex flex-col gap-4">
            <Card size="sm">
              <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex w-full flex-col gap-1 lg:w-64">
                  <span className="text-xs text-muted-foreground">Show</span>
                  <Select
                    value={filter}
                    onValueChange={(value) => setFilter(parseOrderFilter(value))}
                  >
                    <SelectTrigger size="sm" aria-label="Filter orders">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="action">Needs action ({counts.action})</SelectItem>
                        <SelectItem value="awaiting-payment">
                          Awaiting payment ({counts.awaitingPayment})
                        </SelectItem>
                        <SelectItem value="in-progress">
                          In progress ({counts.inProgress})
                        </SelectItem>
                        <SelectItem value="delivered">Delivered ({counts.delivered})</SelectItem>
                        <SelectItem value="cancelled">Cancelled ({counts.cancelled})</SelectItem>
                        <SelectItem value="all">All orders ({counts.all})</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 flex-1">
                  <SearchToolbar
                    label="Search orders"
                    placeholder="Search orders"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    result={`${filtered.length} of ${orders.length} orders`}
                  />
                </div>
                <div className="flex w-full flex-col gap-1 lg:w-44">
                  <span className="text-xs text-muted-foreground">Sort</span>
                  <Select value={sort} onValueChange={(value) => setSort(value as OrderSort)}>
                    <SelectTrigger size="sm" aria-label="Sort orders">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="oldest">Oldest waiting</SelectItem>
                        <SelectItem value="newest">Newest</SelectItem>
                        <SelectItem value="value">Highest value</SelectItem>
                        <SelectItem value="city">Delivery city</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
            {filtered.length ? (
              <div className="flex flex-col gap-3">
                {filtered.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    waitingLabel={formatWaitingLabel(order.created_at, nowTick)}
                    urgent={needsAction(order) && waitingHours(order.created_at, nowTick) >= 48}
                    busy={busyId === order.id}
                    open={openIds.has(order.id)}
                    onToggle={(next) => toggleOpen(order.id, next)}
                    onFulfill={openFulfill}
                    onCancel={openCancel}
                    onDecline={openDecline}
                    onReturn={openReturn}
                    onDecideCancellation={openCancelDecision}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Search}
                title={searchTerm ? "No matching orders" : "Nothing waiting here"}
                copy={
                  searchTerm
                    ? "Try a different order number, retailer, or product."
                    : "Orders appear in this view as their status changes."
                }
                action={
                  searchTerm ? undefined : (
                    <Button variant="outline" type="button" onClick={() => setFilter("all")}>
                      Show all orders
                    </Button>
                  )
                }
              />
            )}
          </div>
        ) : (
          <EmptyState
            icon={Package}
            title="No orders yet"
            copy="Orders that include your products will show up here."
          />
        )
      ) : (
        <LoadingState title="Loading your orders…" />
      )}

      <AlertDialog
        open={fulfillTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFulfillTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {fulfillTarget
                ? fulfillTarget.action === "confirmed"
                  ? `Confirm order #${shortId(fulfillTarget.order.id)}?`
                  : fulfillTarget.action === "dispatched"
                    ? `Mark order #${shortId(fulfillTarget.order.id)} dispatched?`
                    : fulfillTarget.action === "out_for_delivery"
                      ? `Mark order #${shortId(fulfillTarget.order.id)} out for delivery?`
                      : `Mark order #${shortId(fulfillTarget.order.id)} delivered?`
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {fulfillTarget?.action === "confirmed"
                ? "Confirm that you can fulfill this order. Delivery starts once admin initiates it."
                : fulfillTarget?.action === "dispatched"
                  ? "Tell the retailer the parcel has left your shop. Then keep the delivery status up to date."
                  : fulfillTarget?.action === "out_for_delivery"
                    ? "Tell the retailer the parcel is on its way. You will mark it delivered once it arrives."
                    : fulfillTarget?.action === "delivered"
                      ? "Only mark delivered after the retailer has received the parcel. They can then verify the delivery."
                      : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirmFulfill}>
              {fulfillTarget ? (deliveryActionLabel(fulfillTarget.action) ?? "Confirm") : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cancelDecision !== null}
        onOpenChange={(open) => {
          if (!open) setCancelDecision(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cancelDecision?.approve
                ? `Approve cancellation of order #${
                    cancelDecision ? shortId(cancelDecision.order.id) : ""
                  }?`
                : `Reject the cancellation request for order #${
                    cancelDecision ? shortId(cancelDecision.order.id) : ""
                  }?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cancelDecision?.approve
                ? cancelDecision.order.shipment_status === "out_for_delivery"
                  ? "The whole order is cancelled. The parcel is out for delivery: merchandise is refunded, but the prepaid delivery charge is kept."
                  : "The whole order is cancelled and everything the retailer paid in advance goes back, including the prepaid delivery charge."
                : "The order continues as normal and the retailer is notified."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Back</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant={cancelDecision?.approve ? "destructive" : "default"}
              onClick={confirmCancelDecision}
            >
              {cancelDecision?.approve ? "Approve & cancel" : "Reject request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={returnTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReturnTarget(null);
            setReturnReason("");
            setReturnInvalid(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Open return{returnTarget ? ` for #${shortId(returnTarget.id)}` : ""}
            </DialogTitle>
            <DialogDescription>
              Start a return for this delivered order. The retailer will be notified.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={returnInvalid || undefined}>
              <FieldLabel htmlFor="return-reason">Reason</FieldLabel>
              <Textarea
                id="return-reason"
                value={returnReason}
                aria-invalid={returnInvalid || undefined}
                onChange={(event) => {
                  setReturnReason(event.target.value);
                  if (event.target.value.trim().length >= 3) setReturnInvalid(false);
                }}
                placeholder="Why is this return being opened?"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setReturnTarget(null);
                setReturnReason("");
                setReturnInvalid(false);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={confirmReturn}>
              Open return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCancelTarget(null);
            setCancelReason("");
            setCancelInvalid(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Cancel order{cancelTarget ? ` #${shortId(cancelTarget.id)}` : ""}
            </DialogTitle>
            <DialogDescription>
              {cancelTarget?.shipment_status === "out_for_delivery"
                ? "This cancels the order immediately. The parcel is out for delivery: merchandise is refunded, but the prepaid delivery charge is kept. Use this when you cannot fulfill the order."
                : "This cancels the order immediately. The retailer is refunded everything paid in advance — merchandise plus prepaid delivery for online orders, the prepaid delivery charge for COD. Use this when you cannot fulfill the order."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={cancelInvalid || undefined}>
              <FieldLabel htmlFor="cancel-reason">Reason</FieldLabel>
              <Textarea
                id="cancel-reason"
                value={cancelReason}
                aria-invalid={cancelInvalid || undefined}
                onChange={(event) => {
                  setCancelReason(event.target.value);
                  if (event.target.value.trim()) setCancelInvalid(false);
                }}
                placeholder="Why is this order being cancelled?"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setCancelTarget(null);
                setCancelReason("");
                setCancelInvalid(false);
              }}
            >
              Keep order
            </Button>
            <Button variant="destructive" type="button" onClick={confirmCancel}>
              Cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={declineTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeclineTarget(null);
            setDeclineReason("");
            setDeclineInvalid(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Decline items{declineTarget ? ` on #${shortId(declineTarget.id)}` : ""}
            </DialogTitle>
            <DialogDescription>
              The retailer is notified immediately. Other suppliers on this order are not affected.
              Prepaid merchandise for these items can be refunded.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={declineInvalid || undefined}>
              <FieldLabel htmlFor="decline-reason">Reason</FieldLabel>
              <Textarea
                id="decline-reason"
                value={declineReason}
                aria-invalid={declineInvalid || undefined}
                onChange={(event) => {
                  setDeclineReason(event.target.value);
                  if (event.target.value.trim()) setDeclineInvalid(false);
                }}
                placeholder="Why can you not fulfill these items?"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setDeclineTarget(null);
                setDeclineReason("");
                setDeclineInvalid(false);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={confirmDecline}>
              Decline items
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SupplierWorkspaceShell>
  );
}
