import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleCheckBig,
  Download,
  Layers,
  Package,
  RefreshCw,
  Search,
  Truck,
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
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
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  SearchToolbar,
  StatCard,
  StatGrid,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { useTableChanges } from "../../workspace-realtime.ts";
import {
  DeliveryDetails,
  OrderRow,
  PaymentBadge,
  shortId,
  StatusBadge,
} from "../orders/order-presentation.tsx";
import { formatDate, formatPrice, formatUpdatedAt, initials } from "../workspace/format.ts";
import { searchParam } from "../workspace/search.ts";
import { RouterLink } from "../workspace/WorkspaceShell.tsx";
import { SupplierWorkspaceShell } from "./supplier-shared.tsx";
import {
  canCollectCod,
  canConfirmOrder,
  canMarkDelivered,
  canShipOrder,
  canSupplierCancel,
  carrierValidationError,
  collectCodPayment,
  filterSupplierOrders,
  loadSupplierOrders,
  requestSupplierCancellation,
  setSupplierOrderStatus,
  shipSupplierOrder,
  SHIPMENT_CARRIERS,
  trackingNumberValidationError,
  trackingUrlValidationError,
  updateSupplierShipment,
  type ShipmentStatus,
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
  | "to-confirm"
  | "to-ship"
  | "in-transit"
  | "delivered"
  | "cancellation-requested"
  | "cancelled"
  | "all";
type OrderSort = "oldest" | "newest" | "value" | "city";
type FulfillAction = "confirmed" | "shipped" | "delivered" | "collect";

const ORDER_FILTERS = new Set<OrderFilter>([
  "action",
  "awaiting-payment",
  "to-confirm",
  "to-ship",
  "in-transit",
  "delivered",
  "cancellation-requested",
  "cancelled",
  "all",
]);

const ORDERS_LIVE_TABLES = ["orders"] as const;

function parseOrderFilter(value: string | null): OrderFilter {
  if (value && ORDER_FILTERS.has(value as OrderFilter)) return value as OrderFilter;
  return "action";
}

function needsAction(order: SupplierOrder): boolean {
  return (
    canConfirmOrder(order) ||
    canShipOrder(order) ||
    canMarkDelivered(order) ||
    canCollectCod(order) ||
    order.cancel_requested
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

function matchesFilter(order: SupplierOrder, filter: OrderFilter): boolean {
  if (filter === "all") return true;
  if (filter === "action") return needsAction(order);
  if (filter === "awaiting-payment") return isAwaitingPayment(order);
  if (filter === "to-confirm") return canConfirmOrder(order);
  if (filter === "to-ship") return canShipOrder(order);
  if (filter === "in-transit") return order.status === "shipped" && !order.cancel_requested;
  if (filter === "delivered") return order.status === "delivered";
  if (filter === "cancellation-requested") {
    return order.cancel_requested && order.status !== "cancelled";
  }
  return order.status === "cancelled";
}

/** Relative wait label from created_at: hours under 48h, otherwise days. */
function formatWaitingLabel(createdAt: string, now = Date.now()): string {
  const elapsedMs = Math.max(0, now - new Date(createdAt).getTime());
  const hours = Math.floor(elapsedMs / 3_600_000);
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

function fulfillCopy(action: FulfillAction): { title: string; body: string; confirm: string } {
  if (action === "confirmed") {
    return {
      title: "Confirm order",
      body: "Confirm that you can fulfill this order. The retailer will see it as confirmed.",
      confirm: "Confirm order",
    };
  }
  if (action === "delivered") {
    return {
      title: "Mark delivered",
      body: "Mark this order as delivered. The retailer can then verify receipt.",
      confirm: "Mark delivered",
    };
  }
  return {
    title: "Record cash collected",
    body: "Record that cash on delivery was collected. The retailer can then download an invoice.",
    confirm: "Record cash collected",
  };
}

function ShipmentSummary({ order }: { order: SupplierOrder }) {
  if (!order.shipment) return null;
  const shipment = order.shipment;
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">
        {shipment.carrier} · {shipment.tracking_number}
      </p>
      <p className="capitalize">{shipment.status.replaceAll("_", " ")}</p>
      {shipment.tracking_url ? (
        <a
          href={shipment.tracking_url}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          Open tracking link
        </a>
      ) : null}
    </div>
  );
}

function OrderActions({
  order,
  disabled,
  onFulfill,
  onCancel,
  onTrack,
  onReturn,
}: {
  order: SupplierOrder;
  disabled: boolean;
  onFulfill: (order: SupplierOrder, action: FulfillAction) => void;
  onCancel: (order: SupplierOrder) => void;
  onTrack: (order: SupplierOrder) => void;
  onReturn: (order: SupplierOrder) => void;
}) {
  if (order.status === "cancelled") {
    return (
      <p className="text-sm text-muted-foreground">
        Cancelled
        {order.manual_refund_status === "pending" ? " · full manual refund pending" : ""}
      </p>
    );
  }
  if (order.cancel_requested) {
    return (
      <p className="text-sm text-muted-foreground">
        Cancellation requested by {order.cancellation_initiator ?? "a participant"} · waiting for
        admin
      </p>
    );
  }
  if (order.status === "delivered" && order.delivery_verified_at && !canOpenReturn(order)) {
    return (
      <p className="text-sm text-muted-foreground">
        Delivery verified · supplier cancellation is closed
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {order.status === "delivered" && order.delivery_verified_at ? (
        <p className="text-sm text-muted-foreground">
          Delivery verified · supplier cancellation is closed
        </p>
      ) : null}
      {canConfirmOrder(order) ? (
        <Button
          size="sm"
          type="button"
          disabled={disabled}
          onClick={() => onFulfill(order, "confirmed")}
        >
          <Check data-icon="inline-start" />
          Confirm order
        </Button>
      ) : null}
      {canShipOrder(order) ? (
        <Button
          size="sm"
          type="button"
          disabled={disabled}
          onClick={() => onFulfill(order, "shipped")}
        >
          Mark shipped
        </Button>
      ) : null}
      {canMarkDelivered(order) ? (
        <Button
          size="sm"
          type="button"
          disabled={disabled}
          onClick={() => onFulfill(order, "delivered")}
        >
          Mark delivered
        </Button>
      ) : null}
      {order.shipment && order.status === "shipped" && !order.cancel_requested ? (
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={disabled}
          onClick={() => onTrack(order)}
        >
          Update tracking
        </Button>
      ) : null}
      {canOpenReturn(order) ? (
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={disabled}
          onClick={() => onReturn(order)}
        >
          Open return
        </Button>
      ) : null}
      {canCollectCod(order) ? (
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={disabled}
          onClick={() => onFulfill(order, "collect")}
        >
          Record cash collected
        </Button>
      ) : null}
      {order.status === "pending" && !canConfirmOrder(order) ? (
        <p className="text-sm text-muted-foreground">
          Waiting for online payment before fulfillment
        </p>
      ) : null}
      {canSupplierCancel(order) ? (
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={disabled}
          onClick={() => onCancel(order)}
        >
          Request cancellation
        </Button>
      ) : !order.supplier_can_cancel ? (
        <p className="text-sm text-muted-foreground">
          Multi-supplier order · contact admin to resolve your fulfillment
        </p>
      ) : null}
    </div>
  );
}

function OrderMobileCard({
  order,
  waitingLabel,
  busy,
  onFulfill,
  onCancel,
  onTrack,
  onReturn,
}: {
  order: SupplierOrder;
  waitingLabel: string;
  busy: boolean;
  onFulfill: (order: SupplierOrder, action: FulfillAction) => void;
  onCancel: (order: SupplierOrder) => void;
  onTrack: (order: SupplierOrder) => void;
  onReturn: (order: SupplierOrder) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-1">
          <span className="truncate font-medium">{order.retailer_name}</span>
          <span className="text-xs text-muted-foreground">
            #{shortId(order.id)} · {waitingLabel}
          </span>
          {order.delivery_city ? (
            <span className="truncate text-xs text-muted-foreground">{order.delivery_city}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={order.status} />
          <span className="font-medium">{formatPrice(order.supplier_total)}</span>
          <PaymentBadge paymentStatus={order.payment_status} paymentMethod={order.payment_method} />
        </div>
      </div>
      {order.cancel_requested ? (
        <Badge variant="destructive">Cancel requested by {order.cancellation_initiator}</Badge>
      ) : null}
      <ShipmentSummary order={order} />
      <OrderActions
        order={order}
        disabled={busy}
        onFulfill={onFulfill}
        onCancel={onCancel}
        onTrack={onTrack}
        onReturn={onReturn}
      />
    </div>
  );
}

export function SupplierOrders({ loadOrders = loadSupplierOrders }: SupplierOrdersProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/orders" });
  const searchStr = useRouterState({ select: (routerState) => routerState.location.searchStr });
  const filter = parseOrderFilter(searchParam(searchStr, "filter"));
  const isMobile = useIsMobile();
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
  const [fulfillTarget, setFulfillTarget] = useState<{
    order: SupplierOrder;
    action: Exclude<FulfillAction, "shipped">;
  } | null>(null);
  const [shipTarget, setShipTarget] = useState<SupplierOrder | null>(null);
  const [shipCarrier, setShipCarrier] = useState<string>(SHIPMENT_CARRIERS[0]);
  const [shipTracking, setShipTracking] = useState("");
  const [shipUrl, setShipUrl] = useState("");
  const [shipNotes, setShipNotes] = useState("");
  const [shipErrors, setShipErrors] = useState<{
    carrier?: string;
    tracking?: string;
    url?: string;
  }>({});
  const [trackTarget, setTrackTarget] = useState<SupplierOrder | null>(null);
  const [trackStatus, setTrackStatus] = useState<ShipmentStatus>("in_transit");
  const [cancelTarget, setCancelTarget] = useState<SupplierOrder | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelInvalid, setCancelInvalid] = useState(false);
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
      toConfirm: list.filter(canConfirmOrder).length,
      toShip: list.filter(canShipOrder).length,
      inTransit: list.filter((order) => order.status === "shipped" && !order.cancel_requested)
        .length,
      delivered: list.filter((order) => order.status === "delivered").length,
      cancellationRequested: list.filter(
        (order) => order.cancel_requested && order.status !== "cancelled",
      ).length,
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

  const openFulfill = (order: SupplierOrder, action: FulfillAction) => {
    if (action === "shipped") {
      setShipCarrier(SHIPMENT_CARRIERS[0]);
      setShipTracking("");
      setShipUrl("");
      setShipNotes("");
      setShipErrors({});
      setShipTarget(order);
      return;
    }
    setFulfillTarget({ order, action });
  };
  const openCancel = (order: SupplierOrder) => {
    setCancelReason("");
    setCancelInvalid(false);
    setCancelTarget(order);
  };
  const openTrack = (order: SupplierOrder) => {
    setTrackStatus(
      order.shipment?.status === "shipped"
        ? "in_transit"
        : (order.shipment?.status ?? "in_transit"),
    );
    setTrackTarget(order);
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
    const work =
      action === "collect"
        ? collectCodPayment(order.id).then(() => {
            setNotice({
              message: `Cash collected for order #${shortId(order.id)}. The retailer can download an invoice.`,
              state: "success",
            });
            retry();
          })
        : setSupplierOrderStatus(order.id, action).then((status) => {
            setNotice({
              message: `Order #${shortId(order.id)} is now ${status}.`,
              state: "success",
            });
            retry();
          });
    void work
      .catch((fulfillError: unknown) => {
        setNotice({
          message:
            fulfillError instanceof Error
              ? fulfillError.message
              : "The order could not be updated.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const confirmShip = () => {
    const order = shipTarget;
    if (!order) return;
    const carrierError = carrierValidationError(shipCarrier);
    const trackingError = trackingNumberValidationError(shipTracking);
    const urlError = trackingUrlValidationError(shipUrl);
    if (carrierError || trackingError || urlError) {
      setShipErrors({
        carrier: carrierError ?? undefined,
        tracking: trackingError ?? undefined,
        url: urlError ?? undefined,
      });
      return;
    }
    setShipTarget(null);
    setBusyId(order.id);
    void shipSupplierOrder(order.id, {
      carrier: shipCarrier,
      trackingNumber: shipTracking,
      trackingUrl: shipUrl,
      notes: shipNotes,
    })
      .then(() => {
        setNotice({
          message: `Order #${shortId(order.id)} shipped via ${shipCarrier.trim()}.`,
          state: "success",
        });
        retry();
      })
      .catch((shipError: unknown) => {
        setNotice({
          message:
            shipError instanceof Error ? shipError.message : "The order could not be shipped.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const confirmTrackUpdate = () => {
    const order = trackTarget;
    if (!order) return;
    setTrackTarget(null);
    setBusyId(order.id);
    void updateSupplierShipment(order.id, { status: trackStatus })
      .then(() => {
        setNotice({
          message: `Tracking for #${shortId(order.id)} updated to ${trackStatus.replaceAll("_", " ")}.`,
          state: "success",
        });
        retry();
      })
      .catch((trackError: unknown) => {
        setNotice({
          message:
            trackError instanceof Error
              ? trackError.message
              : "Shipment tracking could not be updated.",
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
    void requestSupplierCancellation(order.id, reason)
      .then(() => {
        setNotice({
          message: `Cancellation of order #${shortId(order.id)} was requested. The retailer, admin, and other suppliers were notified.`,
          state: "info",
        });
        retry();
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
        title="Order work queue"
        copy="Start with orders that need action, then track shipments, delivery, and COD collection."
        actions={
          <>
            {updatedAt ? (
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {refreshing ? "Refreshing" : formatUpdatedAt(updatedAt, nowTick)}
              </span>
            ) : null}
            <Button type="button" variant="ghost" disabled={refreshing} onClick={retry}>
              <RefreshCw data-icon="inline-start" />
              {refreshing ? "Refreshing" : "Refresh"}
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
            <Button asChild variant="outline">
              <RouterLink to="/supplier/stock">
                <Layers data-icon="inline-start" />
                Inventory
              </RouterLink>
            </Button>
          </>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {orders?.length ? (
        <StatGrid label="Order fulfillment summary">
          <StatCard
            label="Needs action"
            value={counts.action}
            detail="Confirm, ship, deliver, collect, or review"
          />
          <StatCard
            label="To confirm"
            value={counts.toConfirm}
            detail={
              <span className="inline-flex items-center gap-1">
                <Check aria-hidden="true" /> Ready to accept
              </span>
            }
          />
          <StatCard
            label="To ship"
            value={counts.toShip}
            detail={
              <span className="inline-flex items-center gap-1">
                <Truck aria-hidden="true" /> Confirmed, awaiting shipment
              </span>
            }
          />
          <StatCard
            label="Delivered"
            value={counts.delivered}
            detail={
              <span className="inline-flex items-center gap-1">
                <CircleCheckBig aria-hidden="true" /> Completed fulfillment
              </span>
            }
          />
        </StatGrid>
      ) : null}
      {orders ? (
        orders.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Fulfillment queue</CardTitle>
              <CardDescription>
                Needs action is selected first so urgent seller work stays visible.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="overflow-x-auto">
                <Tabs value={filter} onValueChange={(value) => setFilter(parseOrderFilter(value))}>
                  <TabsList variant="line" className="w-max min-w-full justify-start">
                    <TabsTrigger value="action">Needs action ({counts.action})</TabsTrigger>
                    <TabsTrigger value="awaiting-payment">
                      Awaiting payment ({counts.awaitingPayment})
                    </TabsTrigger>
                    <TabsTrigger value="to-confirm">To confirm ({counts.toConfirm})</TabsTrigger>
                    <TabsTrigger value="to-ship">To ship ({counts.toShip})</TabsTrigger>
                    <TabsTrigger value="in-transit">In transit ({counts.inTransit})</TabsTrigger>
                    <TabsTrigger value="delivered">Delivered ({counts.delivered})</TabsTrigger>
                    <TabsTrigger value="cancellation-requested">
                      Cancel requested ({counts.cancellationRequested})
                    </TabsTrigger>
                    <TabsTrigger value="cancelled">Cancelled ({counts.cancelled})</TabsTrigger>
                    <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <SearchToolbar
                  label="Search orders"
                  placeholder="Search orders"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  result={`${filtered.length} of ${orders.length} orders`}
                />
                <div className="flex shrink-0 flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Sort</span>
                  <Select value={sort} onValueChange={(value) => setSort(value as OrderSort)}>
                    <SelectTrigger size="sm" aria-label="Sort orders" className="w-44">
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
              </div>
              {filtered.length ? (
                isMobile ? (
                  <div className="flex flex-col gap-3">
                    {filtered.map((order) => (
                      <OrderMobileCard
                        key={order.id}
                        order={order}
                        waitingLabel={formatWaitingLabel(order.created_at, nowTick)}
                        busy={busyId === order.id}
                        onFulfill={openFulfill}
                        onCancel={openCancel}
                        onTrack={openTrack}
                        onReturn={openReturn}
                      />
                    ))}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead>Placed</TableHead>
                        <TableHead>Waiting</TableHead>
                        <TableHead>Retailer</TableHead>
                        <TableHead>Units</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>
                          <span className="sr-only">Order lines</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((order) => (
                        <OrderRow
                          key={order.id}
                          colSpan={9}
                          toggleLabel={`Toggle lines for order #${shortId(order.id)}`}
                          summaryCells={
                            <>
                              <TableCell>
                                <span className="font-medium">#{shortId(order.id)}</span>
                              </TableCell>
                              <TableCell>{formatDate(order.created_at)}</TableCell>
                              <TableCell>
                                <span className="text-sm text-muted-foreground">
                                  {formatWaitingLabel(order.created_at, nowTick)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Avatar size="sm">
                                    <AvatarFallback>{initials(order.retailer_name)}</AvatarFallback>
                                  </Avatar>
                                  <span className="flex min-w-0 flex-col">
                                    <span className="truncate font-medium">
                                      {order.retailer_name}
                                    </span>
                                    <span className="truncate text-xs text-muted-foreground">
                                      {order.retailer_email}
                                    </span>
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {order.items.reduce((sum, item) => sum + item.quantity, 0)}
                              </TableCell>
                              <TableCell>
                                <span className="font-medium">
                                  {formatPrice(order.supplier_total)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <PaymentBadge
                                  paymentStatus={order.payment_status}
                                  paymentMethod={order.payment_method}
                                />
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap items-center gap-1">
                                  <StatusBadge status={order.status} />
                                  {order.cancel_requested ? (
                                    <Badge variant="destructive">
                                      Cancel requested by {order.cancellation_initiator}
                                    </Badge>
                                  ) : null}
                                </div>
                              </TableCell>
                            </>
                          }
                          detail={
                            <div className="flex flex-col gap-4">
                              <div className="flex flex-col gap-2">
                                {order.items.map((item) => (
                                  <div
                                    className="flex items-center justify-between gap-4 text-sm"
                                    key={item.id}
                                  >
                                    <span className="font-medium">{item.product_name}</span>
                                    <span className="text-muted-foreground">
                                      {item.quantity} × {formatPrice(item.unit_price)}
                                    </span>
                                    <span className="font-medium">
                                      {formatPrice(item.line_total)}
                                    </span>
                                  </div>
                                ))}
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
                              <ShipmentSummary order={order} />
                              <OrderActions
                                order={order}
                                disabled={busyId === order.id}
                                onFulfill={openFulfill}
                                onCancel={openCancel}
                                onTrack={openTrack}
                                onReturn={openReturn}
                              />
                            </div>
                          }
                        />
                      ))}
                    </TableBody>
                  </Table>
                )
              ) : (
                <EmptyState
                  icon={Search}
                  title="No matching orders"
                  copy="Try a different order number, retailer, or product."
                />
              )}
            </CardContent>
          </Card>
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
                ? `${fulfillCopy(fulfillTarget.action).title} #${shortId(fulfillTarget.order.id)}?`
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {fulfillTarget ? fulfillCopy(fulfillTarget.action).body : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirmFulfill}>
              {fulfillTarget ? fulfillCopy(fulfillTarget.action).confirm : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={shipTarget !== null}
        onOpenChange={(open) => {
          if (!open) setShipTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ship order{shipTarget ? ` #${shortId(shipTarget.id)}` : ""}</DialogTitle>
            <DialogDescription>
              Add the carrier and tracking number so the retailer can follow the shipment.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={shipErrors.carrier ? true : undefined}>
              <FieldLabel htmlFor="ship-carrier">Carrier</FieldLabel>
              <Select value={shipCarrier} onValueChange={setShipCarrier}>
                <SelectTrigger id="ship-carrier" className="w-full">
                  <SelectValue placeholder="Select carrier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {SHIPMENT_CARRIERS.map((carrier) => (
                      <SelectItem key={carrier} value={carrier}>
                        {carrier}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {shipErrors.carrier ? (
                <p className="text-sm text-destructive">{shipErrors.carrier}</p>
              ) : null}
            </Field>
            <Field data-invalid={shipErrors.tracking ? true : undefined}>
              <FieldLabel htmlFor="ship-tracking">Tracking number</FieldLabel>
              <Input
                id="ship-tracking"
                value={shipTracking}
                aria-invalid={shipErrors.tracking ? true : undefined}
                onChange={(event) => {
                  setShipTracking(event.target.value);
                  if (event.target.value.trim()) {
                    setShipErrors((prev) => ({ ...prev, tracking: undefined }));
                  }
                }}
                placeholder="e.g. SF123456789BD"
              />
              {shipErrors.tracking ? (
                <p className="text-sm text-destructive">{shipErrors.tracking}</p>
              ) : null}
            </Field>
            <Field data-invalid={shipErrors.url ? true : undefined}>
              <FieldLabel htmlFor="ship-url">Tracking URL (optional)</FieldLabel>
              <Input
                id="ship-url"
                value={shipUrl}
                aria-invalid={shipErrors.url ? true : undefined}
                onChange={(event) => setShipUrl(event.target.value)}
                placeholder="https://"
              />
              {shipErrors.url ? <p className="text-sm text-destructive">{shipErrors.url}</p> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="ship-notes">Notes (optional)</FieldLabel>
              <Textarea
                id="ship-notes"
                value={shipNotes}
                onChange={(event) => setShipNotes(event.target.value)}
                placeholder="Packing or courier notes"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setShipTarget(null)}>
              Back
            </Button>
            <Button type="button" onClick={confirmShip}>
              Mark shipped
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={trackTarget !== null}
        onOpenChange={(open) => {
          if (!open) setTrackTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Update tracking{trackTarget ? ` #${shortId(trackTarget.id)}` : ""}
            </DialogTitle>
            <DialogDescription>
              Record the latest carrier status for this shipment.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="track-status">Shipment status</FieldLabel>
              <Select
                value={trackStatus}
                onValueChange={(value) => setTrackStatus(value as ShipmentStatus)}
              >
                <SelectTrigger id="track-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="shipped">Shipped</SelectItem>
                    <SelectItem value="in_transit">In transit</SelectItem>
                    <SelectItem value="out_for_delivery">Out for delivery</SelectItem>
                    <SelectItem value="delivered">Delivered (carrier)</SelectItem>
                    <SelectItem value="exception">Exception</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            {trackTarget?.shipment ? (
              <p className="text-sm text-muted-foreground">
                Current: {trackTarget.shipment.carrier} · {trackTarget.shipment.tracking_number}
              </p>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setTrackTarget(null)}>
              Back
            </Button>
            <Button type="button" onClick={confirmTrackUpdate}>
              Save tracking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              Back
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
              Request cancellation{cancelTarget ? ` of #${shortId(cancelTarget.id)}` : ""}
            </DialogTitle>
            <DialogDescription>
              A paid online order will require a full manual refund. Add a reason so admin and the
              retailer can review the request.
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
                placeholder="Why should this order be cancelled?"
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
              Back
            </Button>
            <Button type="button" onClick={confirmCancel}>
              Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SupplierWorkspaceShell>
  );
}
