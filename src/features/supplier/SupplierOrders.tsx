import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Download, RefreshCw } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { useTableChanges } from "../../workspace-realtime.ts";
import { deliveryActionLabel } from "../orders/DeliveryStatus.tsx";
import { OrderDetailSheet } from "../orders/order-detail-sheet.tsx";
import {
  DeliveryDetails,
  matchesStatusTab,
  orderTypeOf,
  primaryProductName,
  shortId,
  statusTabOf,
  type OrderStatusTab,
} from "../orders/order-presentation.tsx";
import {
  OrdersDataTable,
  type OrderMenuItem,
  type OrderTableRow,
} from "../orders/orders-data-table.tsx";
import { loadProductImageMap } from "../orders/product-images.ts";
import { formatPrice } from "../workspace/format.ts";
import { searchParam } from "../workspace/search.ts";
import { SupplierWorkspaceShell } from "./supplier-shared.tsx";
import {
  approveSupplierCancellation,
  canConfirmOrder,
  canDeclineOrderItems,
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

type SupplierOrdersProps = {
  loadOrders?: () => Promise<SupplierOrder[]>;
};

type Notice = { message: string; state: NoticeState } | null;
type FulfillAction = SupplierDeliveryAction;
type CancelDecision = { order: SupplierOrder; approve: boolean };

const ORDERS_LIVE_TABLES = ["orders"] as const;

function parseTab(value: string | null): OrderStatusTab {
  if (
    value === "all" ||
    value === "pending" ||
    value === "shipped" ||
    value === "delivered" ||
    value === "cancelled"
  ) {
    return value;
  }
  if (value === "in-progress" || value === "to-ship" || value === "in-transit") return "shipped";
  if (value === "action" || value === "to-confirm" || value === "awaiting-payment")
    return "pending";
  return "pending";
}

function needsAction(order: SupplierOrder): boolean {
  return (
    canConfirmOrder(order) ||
    canDeclineOrderItems(order) ||
    canSupplierCancel(order) ||
    hasRetailerCancellationRequest(order)
  );
}

function isAwaitingPayment(order: SupplierOrder): boolean {
  return (
    order.status === "pending" && order.payment_method !== "cod" && order.payment_status !== "paid"
  );
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

function orderExplanation(order: SupplierOrder): string | null {
  if (order.status === "cancelled") {
    return order.manual_refund_status === "pending"
      ? "This order was cancelled. A manual refund is pending."
      : "This order was cancelled.";
  }
  if (hasRetailerCancellationRequest(order)) {
    return order.delivery_initiated_at
      ? "The retailer asked to cancel, but delivery has already started so it can no longer be cancelled."
      : "The retailer asked to cancel this order. Approving cancels it.";
  }
  if (order.cancel_requested) {
    return "You requested cancellation of this order. Confirm below to cancel it now.";
  }
  if (order.delivery_payment_status !== "paid") {
    return "Waiting for the retailer to pay the delivery charge.";
  }
  if (order.status === "delivered") return "Delivery is complete.";
  if (order.status === "pending" && !canConfirmOrder(order)) {
    return "Waiting for online payment before fulfillment.";
  }
  if (order.package_status === "confirmed" && !isDeliveryInitiated(order)) {
    return "Waiting for admin to start delivery.";
  }
  if (order.package_status === "declined") {
    return `You declined these items${order.decline_reason ? ` · ${order.decline_reason}` : ""}`;
  }
  return null;
}

function toRow(order: SupplierOrder, images: Map<string, string>): OrderTableRow {
  const product = primaryProductName(order.items);
  const firstId = order.items[0]?.product_id;
  return {
    id: order.id,
    productName: product.name,
    productImageUrl: firstId ? (images.get(firstId) ?? null) : null,
    extraItemCount: product.extraCount,
    customerName: order.retailer_name,
    customerEmail: order.retailer_email,
    type: orderTypeOf(order),
    price: order.supplier_total,
    date: order.created_at,
    status: order.status,
  };
}

export function SupplierOrders({ loadOrders = loadSupplierOrders }: SupplierOrdersProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/orders" });
  const searchStr = useRouterState({ select: (routerState) => routerState.location.searchStr });
  const filterParam = searchParam(searchStr, "filter");
  const focusOrderId = searchParam(searchStr, "order");
  const tab = parseTab(filterParam);
  const [orders, setOrders] = useState<SupplierOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(focusOrderId);
  const [needsActionOnly, setNeedsActionOnly] = useState(
    () => filterParam === "action" || filterParam === "to-confirm",
  );
  const [awaitingPaymentOnly, setAwaitingPaymentOnly] = useState(
    () => filterParam === "awaiting-payment",
  );
  const [images, setImages] = useState<Map<string, string>>(() => new Map());
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

  const isSeller = state.status === "seller";
  const retry = useCallback(() => setLoadVersion((version) => version + 1), []);

  useEffect(() => {
    if (focusOrderId) setOpenOrderId(focusOrderId);
  }, [focusOrderId]);

  useEffect(() => {
    if (!isSeller) return;
    let current = true;
    setError(null);
    setRefreshing(true);

    void loadOrders()
      .then((nextOrders) => {
        if (current) {
          setOrders(nextOrders);
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

  useEffect(() => {
    if (!orders?.length) return;
    const ids = orders.flatMap((order) => order.items.map((item) => item.product_id));
    void loadProductImageMap(ids).then(setImages);
  }, [orders]);

  const searched = useMemo(
    () => (orders ? filterSupplierOrders(orders, searchTerm, shortId) : []),
    [orders, searchTerm],
  );
  const filtered = useMemo(
    () =>
      searched.filter((order) => {
        if (needsActionOnly && !needsAction(order)) return false;
        if (awaitingPaymentOnly && !isAwaitingPayment(order)) return false;
        if (tab === "cancelled") return order.status === "cancelled" || order.cancel_requested;
        return matchesStatusTab(order.status, tab);
      }),
    [searched, needsActionOnly, awaitingPaymentOnly, tab],
  );
  const counts = useMemo(() => {
    const list = searched;
    return {
      all: list.length,
      pending: list.filter((order) => statusTabOf(order.status) === "pending").length,
      shipped: list.filter((order) => order.status === "shipped").length,
      delivered: list.filter((order) => order.status === "delivered").length,
      cancelled: list.filter((order) => order.status === "cancelled" || order.cancel_requested)
        .length,
    };
  }, [searched]);

  if (state.status !== "seller") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const userName = state.profile.name || state.profile.email;

  const setTab = (value: OrderStatusTab) => {
    setNeedsActionOnly(false);
    setAwaitingPaymentOnly(false);
    void navigate({
      to: "/supplier/orders",
      search: (value === "pending" ? {} : { filter: value }) as never,
    });
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
              ? `Order #${shortId(order.id)} is confirmed. Admin starts and handles delivery.`
              : `Order #${shortId(order.id)} was updated.`,
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
                ? `Order #${shortId(order.id)} was cancelled. A manual refund of ${formatPrice(result.refundAmount)} is queued.`
                : `Order #${shortId(order.id)} was cancelled.`,
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
          message: `Cancellation request for order #${shortId(order.id)} was rejected.`,
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
          message: `Order #${shortId(order.id)} was cancelled.`,
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
          message: `You declined your items on order #${shortId(order.id)}.`,
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

  const byId = new Map((orders ?? []).map((order) => [order.id, order]));
  const rows = filtered.map((order) => toRow(order, images));
  const openOrder = orders?.find((order) => order.id === openOrderId) ?? null;

  return (
    <SupplierWorkspaceShell
      section="orders"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        title="Orders"
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Refresh"
              disabled={refreshing}
              onClick={retry}
            >
              {refreshing ? <Spinner /> : <RefreshCw />}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!filtered.length}
              onClick={() => exportOrdersCsv(filtered)}
            >
              <Download data-icon="inline-start" />
              Export
            </Button>
          </>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {orders ? (
        <OrdersDataTable
          rows={rows}
          tab={tab}
          onTabChange={setTab}
          counts={counts}
          showColumns={false}
          search={searchTerm}
          onSearchChange={setSearchTerm}
          activeFilterCount={(needsActionOnly ? 1 : 0) + (awaitingPaymentOnly ? 1 : 0)}
          extraFilters={
            <>
              <Field orientation="horizontal">
                <Checkbox
                  id="supplier-needs-action"
                  checked={needsActionOnly}
                  onCheckedChange={(checked) => setNeedsActionOnly(checked === true)}
                />
                <FieldLabel htmlFor="supplier-needs-action">Needs action</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="supplier-awaiting-payment"
                  checked={awaitingPaymentOnly}
                  onCheckedChange={(checked) => setAwaitingPaymentOnly(checked === true)}
                />
                <FieldLabel htmlFor="supplier-awaiting-payment">Awaiting payment</FieldLabel>
              </Field>
            </>
          }
          onRowOpen={setOpenOrderId}
          onExportSelected={(ids) => {
            const selected = ids
              .map((id) => byId.get(id))
              .filter((order): order is SupplierOrder => Boolean(order));
            if (selected.length) exportOrdersCsv(selected);
          }}
          rowMenuItems={(row) => {
            const order = byId.get(row.id);
            const items: OrderMenuItem[] = [
              { label: "View details", onSelect: () => setOpenOrderId(row.id) },
            ];
            if (!order) return items;
            if (hasRetailerCancellationRequest(order)) {
              items.push({
                label: "Approve cancellation",
                destructive: true,
                onSelect: () => setCancelDecision({ order, approve: true }),
              });
              items.push({
                label: "Reject request",
                onSelect: () => setCancelDecision({ order, approve: false }),
              });
              return items;
            }
            if (canConfirmOrder(order)) {
              items.push({
                label: deliveryActionLabel("confirmed") ?? "Confirm order",
                onSelect: () => setFulfillTarget({ order, action: "confirmed" }),
              });
            }
            if (canDeclineOrderItems(order)) {
              items.push({
                label: "Decline items",
                onSelect: () => {
                  setDeclineReason("");
                  setDeclineInvalid(false);
                  setDeclineTarget(order);
                },
              });
            }
            if (canSupplierCancel(order) || order.cancel_requested) {
              items.push({
                label: "Cancel order",
                destructive: true,
                onSelect: () => {
                  setCancelReason("");
                  setCancelInvalid(false);
                  setCancelTarget(order);
                },
              });
            }
            return items;
          }}
          emptyTitle={searchTerm ? "No matching orders" : "Nothing in this tab"}
          emptyCopy={
            searchTerm
              ? "Try a different order number, retailer, or product."
              : "Orders appear here as their status changes."
          }
          emptyAction={
            tab !== "all" ? (
              <Button variant="outline" type="button" onClick={() => setTab("all")}>
                Show all orders
              </Button>
            ) : undefined
          }
        />
      ) : (
        <LoadingState title="Loading your orders…" />
      )}

      <OrderDetailSheet
        open={openOrder !== null}
        onOpenChange={(open) => {
          if (!open) setOpenOrderId(null);
        }}
        title={openOrder ? `Order #${shortId(openOrder.id)}` : "Order"}
        description={
          openOrder
            ? `${openOrder.retailer_name} · ${formatPrice(openOrder.supplier_total)}`
            : undefined
        }
        footer={
          openOrder && (needsAction(openOrder) || openOrder.cancel_requested) ? (
            <>
              {hasRetailerCancellationRequest(openOrder) ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busyId === openOrder.id}
                    onClick={() => setCancelDecision({ order: openOrder, approve: false })}
                  >
                    Reject
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busyId === openOrder.id}
                    onClick={() => setCancelDecision({ order: openOrder, approve: true })}
                  >
                    Approve &amp; cancel
                  </Button>
                </>
              ) : null}
              {canConfirmOrder(openOrder) ? (
                <Button
                  type="button"
                  disabled={busyId === openOrder.id}
                  onClick={() => setFulfillTarget({ order: openOrder, action: "confirmed" })}
                >
                  {busyId === openOrder.id ? <Spinner data-icon="inline-start" /> : null}
                  {deliveryActionLabel("confirmed")}
                </Button>
              ) : null}
              {canDeclineOrderItems(openOrder) ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyId === openOrder.id}
                  onClick={() => {
                    setDeclineReason("");
                    setDeclineInvalid(false);
                    setDeclineTarget(openOrder);
                  }}
                >
                  Decline items
                </Button>
              ) : null}
              {canSupplierCancel(openOrder) || openOrder.cancel_requested ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyId === openOrder.id}
                  onClick={() => {
                    setCancelReason("");
                    setCancelInvalid(false);
                    setCancelTarget(openOrder);
                  }}
                >
                  <Ban data-icon="inline-start" />
                  Cancel order
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {openOrder ? (
          <div className="flex flex-col gap-4 pb-4">
            {orderExplanation(openOrder) ? (
              <p className="text-sm text-muted-foreground">{orderExplanation(openOrder)}</p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {openOrder.items.map((item) => (
                <li className="flex items-center justify-between gap-3 text-sm" key={item.id}>
                  <span className="min-w-0 truncate font-medium">{item.product_name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {item.quantity} × {formatPrice(item.unit_price)}
                  </span>
                </li>
              ))}
            </ul>
            <DeliveryDetails
              phone={openOrder.delivery_phone}
              address={openOrder.delivery_address}
              city={openOrder.delivery_city}
              postcode={openOrder.delivery_postcode}
            />
          </div>
        ) : null}
      </OrderDetailSheet>

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
                  : `Update order #${shortId(fulfillTarget.order.id)}?`
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {fulfillTarget?.action === "confirmed"
                ? "Confirm that you can fulfill this order. The admin team then starts and handles delivery."
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
                ? "The whole order is cancelled. Online orders are refunded in full; COD orders get the prepaid delivery charge back."
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
              This cancels the order immediately. Use this when you cannot fulfill it.
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
