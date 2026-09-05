import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import {
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { DeliveryStatusCard } from "../orders/DeliveryStatus.tsx";
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
import { recordIdFromHash, searchParam } from "../workspace/search.ts";
import { AdminWorkspaceShell } from "./admin-workspace-shell.tsx";
import {
  canAdvanceDelivery,
  canFulfillOrder,
  canInitiateDelivery,
  collectCodPayment,
  completeManualRefund,
  deliveryStatusLabel,
  filterActivityOrders,
  initiateDelivery,
  isDeliveryInitiated,
  loadAdminActivity,
  needsCodCollection,
  nextDeliveryStatus,
  orderDeliveryStatus,
  packageStatusLabel,
  parseAdminOrderView,
  updateDeliveryStatus,
  type ActivityOrder,
  type ActivityResponse,
  type AdminDeliveryStatus,
  type AdminOrderView,
} from "./admin-activity-api.ts";

type AdminActivityProps = {
  loadActivity?: () => Promise<ActivityResponse>;
};

type Notice = { message: string; state: NoticeState } | null;

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function exportOrdersCsv(orders: readonly ActivityOrder[]): void {
  const header = ["id", "date", "retailer", "status", "payment", "total"];
  const lines = [
    header.join(","),
    ...orders.map((order) =>
      [
        order.id,
        order.created_at,
        order.retailer_name,
        order.status,
        `${order.payment_method}/${order.payment_status}`,
        String(order.total),
      ]
        .map((cell) => csvEscape(cell))
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `admin-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function tabFromView(view: AdminOrderView): OrderStatusTab {
  switch (view) {
    case "new":
      return "pending";
    case "dispatched":
      return "shipped";
    case "delivered":
      return "delivered";
    case "cancellations":
      return "cancelled";
    default:
      return "all";
  }
}

function searchFromTab(tab: OrderStatusTab): Record<string, string> {
  switch (tab) {
    case "pending":
      return { view: "new" };
    case "shipped":
      return { view: "dispatched" };
    case "delivered":
      return { view: "delivered" };
    case "cancelled":
      return { view: "cancellations" };
    default:
      return {};
  }
}

function adminNeedsAction(order: ActivityOrder): boolean {
  return (
    canInitiateDelivery(order) ||
    canAdvanceDelivery(order) ||
    needsCodCollection(order) ||
    order.manual_refund_status === "pending" ||
    order.manual_refund_status === "review_required" ||
    order.cancel_requested
  );
}

function isRefundQueue(order: ActivityOrder): boolean {
  return (
    order.manual_refund_status === "review_required" || order.manual_refund_status === "pending"
  );
}

function attentionCopy(order: ActivityOrder): string | null {
  if (order.cancel_requested) {
    return `Cancellation requested by ${order.cancellation_initiator ?? "a participant"}. Suppliers review it.`;
  }
  if (!canFulfillOrder(order) && order.status !== "cancelled") {
    return "Delivery must be paid before this order can move forward.";
  }
  if (canInitiateDelivery(order)) {
    return "Every supplier confirmed. Start delivery to lock the order and take over the status.";
  }
  if (order.status === "pending") {
    return "Waiting for suppliers to confirm their items.";
  }
  if (order.status === "confirmed" && !isDeliveryInitiated(order)) {
    return "Some items are still waiting for supplier confirmation.";
  }
  if (isDeliveryInitiated(order) && order.status !== "delivered") {
    return "Delivery is in progress. Keep the status moving until it arrives.";
  }
  return null;
}

function toRow(order: ActivityOrder, images: Map<string, string>): OrderTableRow {
  const product = primaryProductName(order.lines);
  const firstId = order.lines[0]?.product_id;
  return {
    id: order.id,
    productName: product.name,
    productImageUrl: firstId ? (images.get(firstId) ?? null) : null,
    extraItemCount: product.extraCount,
    customerName: order.retailer_name,
    customerEmail: order.retailer_email,
    type: orderTypeOf(order),
    price: order.total,
    date: order.created_at,
    status: order.status,
  };
}

export function AdminActivity({ loadActivity = loadAdminActivity }: AdminActivityProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/admin/order" });
  const location = useRouterState({ select: (routerState) => routerState.location });
  const focusedOrderId =
    searchParam(location.searchStr, "order") ?? recordIdFromHash(location.hash, "order");
  const orderView = parseAdminOrderView(searchParam(location.searchStr, "view"));
  const tab = tabFromView(orderView);
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(focusedOrderId);
  const [needsActionOnly, setNeedsActionOnly] = useState(false);
  const [refundsOnly, setRefundsOnly] = useState(() => orderView === "refunds");
  const [images, setImages] = useState<Map<string, string>>(() => new Map());
  const [initiateTarget, setInitiateTarget] = useState<ActivityOrder | null>(null);
  const [deliveryTarget, setDeliveryTarget] = useState<{
    order: ActivityOrder;
    status: AdminDeliveryStatus;
  } | null>(null);
  const [refundConfirmation, setRefundConfirmation] = useState<ActivityOrder | null>(null);
  const [codConfirmation, setCodConfirmation] = useState<ActivityOrder | null>(null);

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

  useEffect(() => {
    if (focusedOrderId) setOpenOrderId(focusedOrderId);
  }, [focusedOrderId]);

  useEffect(() => {
    setRefundsOnly(orderView === "refunds");
  }, [orderView]);

  const orders = data?.orders ?? null;

  useEffect(() => {
    if (!orders?.length) return;
    const ids = orders.flatMap((order) => order.lines.map((line) => line.product_id));
    void loadProductImageMap(ids).then(setImages);
  }, [orders]);

  if (state.status !== "admin") return null;

  const onLogout = () => {
    void store.signOut();
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || "Administrator";

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Admin"
        title="We could not load orders."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const confirmInitiateDelivery = () => {
    if (!initiateTarget) return;
    const order = initiateTarget;
    setInitiateTarget(null);
    setBusyId(order.id);
    void initiateDelivery(order.id)
      .then(() => {
        setNotice({
          message: `Delivery was initiated for order #${shortId(order.id)}. The order is now locked against cancellation.`,
          state: "success",
        });
        setLoadVersion((version) => version + 1);
      })
      .catch((initiateError: unknown) => {
        setNotice({
          message:
            initiateError instanceof Error
              ? initiateError.message
              : "Delivery could not be initiated.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const confirmUpdateDelivery = () => {
    if (!deliveryTarget) return;
    const { order, status } = deliveryTarget;
    setDeliveryTarget(null);
    setBusyId(order.id);
    void updateDeliveryStatus(order.id, status)
      .then(() => {
        setNotice({
          message: `Order #${shortId(order.id)} was marked ${deliveryStatusLabel(status).toLowerCase()}.`,
          state: "success",
        });
        setLoadVersion((version) => version + 1);
      })
      .catch((deliveryError: unknown) => {
        setNotice({
          message:
            deliveryError instanceof Error
              ? deliveryError.message
              : "The delivery status could not be updated.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const confirmCollectCod = () => {
    if (!codConfirmation) return;
    const order = codConfirmation;
    setCodConfirmation(null);
    setBusyId(order.id);
    void collectCodPayment(order.id)
      .then(() => {
        setNotice({
          message: `Cash collected for order #${shortId(order.id)}.`,
          state: "success",
        });
        setLoadVersion((version) => version + 1);
      })
      .catch((codError: unknown) => {
        setNotice({
          message:
            codError instanceof Error ? codError.message : "Cash collection could not be recorded.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const confirmCompleteRefund = () => {
    if (!refundConfirmation) return;
    const order = refundConfirmation;
    setRefundConfirmation(null);
    setBusyId(order.id);
    void completeManualRefund(order.id)
      .then(() => {
        setNotice({
          message: `Manual refund for order #${shortId(order.id)} was marked completed.`,
          state: "success",
        });
        setLoadVersion((version) => version + 1);
      })
      .catch((refundError: unknown) => {
        setNotice({
          message:
            refundError instanceof Error
              ? refundError.message
              : "The refund could not be marked completed.",
          state: "error",
        });
      })
      .finally(() => setBusyId(null));
  };

  const setTab = (next: OrderStatusTab) => {
    setRefundsOnly(false);
    void navigate({
      to: "/admin/order",
      search: searchFromTab(next) as never,
      replace: true,
    });
  };

  const searched = orders ? filterActivityOrders(orders, searchTerm, shortId, "all") : [];
  const filtered = searched.filter((order) => {
    if (refundsOnly && !isRefundQueue(order)) return false;
    if (needsActionOnly && !adminNeedsAction(order)) return false;
    if (tab === "cancelled") return order.status === "cancelled" || order.cancel_requested;
    return matchesStatusTab(order.status, tab);
  });
  const counts = {
    all: searched.length,
    pending: searched.filter((order) => statusTabOf(order.status) === "pending").length,
    shipped: searched.filter((order) => order.status === "shipped").length,
    delivered: searched.filter((order) => order.status === "delivered").length,
    cancelled: searched.filter((order) => order.status === "cancelled" || order.cancel_requested)
      .length,
  };

  const rows = filtered.map((order) => toRow(order, images));
  const openOrder = orders?.find((order) => order.id === openOrderId) ?? null;
  const byId = new Map((orders ?? []).map((order) => [order.id, order]));

  return (
    <AdminWorkspaceShell
      activePath="/admin/order"
      orderView={orderView}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        title="Orders"
        actions={
          <Button type="button" variant="ghost" size="icon" aria-label="Refresh" onClick={retry}>
            {loading ? <Spinner /> : <RefreshCw />}
          </Button>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {data && orders ? (
        <OrdersDataTable
          rows={rows}
          tab={tab}
          onTabChange={setTab}
          counts={counts}
          showColumns={false}
          search={searchTerm}
          onSearchChange={setSearchTerm}
          activeFilterCount={(needsActionOnly ? 1 : 0) + (refundsOnly ? 1 : 0)}
          extraFilters={
            <>
              <Field orientation="horizontal">
                <Checkbox
                  id="admin-needs-action"
                  checked={needsActionOnly}
                  onCheckedChange={(checked) => setNeedsActionOnly(checked === true)}
                />
                <FieldLabel htmlFor="admin-needs-action">Needs action</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="admin-refunds"
                  checked={refundsOnly}
                  onCheckedChange={(checked) => setRefundsOnly(checked === true)}
                />
                <FieldLabel htmlFor="admin-refunds">Refunds</FieldLabel>
              </Field>
            </>
          }
          onRowOpen={setOpenOrderId}
          onExportSelected={(ids) => {
            const selected = ids
              .map((id) => byId.get(id))
              .filter((order): order is ActivityOrder => Boolean(order));
            if (selected.length) exportOrdersCsv(selected);
          }}
          rowMenuItems={(row) => {
            const order = byId.get(row.id);
            const items: OrderMenuItem[] = [
              { label: "View details", onSelect: () => setOpenOrderId(row.id) },
            ];
            if (!order) return items;
            if (canInitiateDelivery(order)) {
              items.push({
                label: "Initiate delivery",
                onSelect: () => setInitiateTarget(order),
              });
            }
            if (canAdvanceDelivery(order)) {
              const next = nextDeliveryStatus(order);
              if (next) {
                items.push({
                  label: `Mark ${deliveryStatusLabel(next).toLowerCase()}`,
                  onSelect: () => setDeliveryTarget({ order, status: next }),
                });
              }
            }
            if (needsCodCollection(order)) {
              items.push({
                label: "Record cash collected",
                onSelect: () => setCodConfirmation(order),
              });
            }
            if (order.manual_refund_status === "pending") {
              items.push({
                label: "Mark refund completed",
                onSelect: () => setRefundConfirmation(order),
              });
            }
            return items;
          }}
          emptyTitle={
            searchTerm || needsActionOnly || refundsOnly ? "No matching orders" : "No orders yet"
          }
          emptyCopy={
            searchTerm || needsActionOnly || refundsOnly
              ? "Try another tab or clear the filters."
              : "New orders show up here."
          }
        />
      ) : (
        <LoadingState title="Loading orders…" />
      )}

      <OrderDetailSheet
        open={openOrder !== null}
        onOpenChange={(open) => {
          if (!open) setOpenOrderId(null);
        }}
        title={openOrder ? `Order #${shortId(openOrder.id)}` : "Order"}
        description={
          openOrder ? `${openOrder.retailer_name} · ${formatPrice(openOrder.total)}` : undefined
        }
        footer={
          openOrder ? (
            <>
              {canInitiateDelivery(openOrder) ? (
                <Button
                  type="button"
                  disabled={busyId === openOrder.id}
                  onClick={() => setInitiateTarget(openOrder)}
                >
                  {busyId === openOrder.id ? <Spinner data-icon="inline-start" /> : null}
                  Initiate delivery
                </Button>
              ) : null}
              {canAdvanceDelivery(openOrder) ? (
                <Button
                  type="button"
                  disabled={busyId === openOrder.id}
                  onClick={() =>
                    setDeliveryTarget({
                      order: openOrder,
                      status: nextDeliveryStatus(openOrder) as AdminDeliveryStatus,
                    })
                  }
                >
                  {busyId === openOrder.id ? <Spinner data-icon="inline-start" /> : null}
                  Mark {deliveryStatusLabel(nextDeliveryStatus(openOrder) as string).toLowerCase()}
                </Button>
              ) : null}
              {needsCodCollection(openOrder) ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyId === openOrder.id}
                  onClick={() => setCodConfirmation(openOrder)}
                >
                  Record cash collected
                </Button>
              ) : null}
              {openOrder.manual_refund_status === "pending" ? (
                <Button
                  type="button"
                  disabled={busyId === openOrder.id}
                  onClick={() => setRefundConfirmation(openOrder)}
                >
                  Mark refund completed
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {openOrder ? (
          <div className="flex flex-col gap-4 pb-4">
            {attentionCopy(openOrder) ? (
              <Alert>
                <AlertTitle>Next step</AlertTitle>
                <AlertDescription>{attentionCopy(openOrder)}</AlertDescription>
              </Alert>
            ) : null}
            <ul className="flex flex-col gap-2">
              {openOrder.lines.map((line) => (
                <li className="flex items-center justify-between gap-3 text-sm" key={line.id}>
                  <span className="min-w-0 truncate font-medium">{line.product_name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {line.quantity} × {formatPrice(line.unit_price)}
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
            <p className="text-sm text-muted-foreground">
              Delivery {formatPrice(openOrder.delivery_charge)} ·{" "}
              {openOrder.delivery_payment_status === "paid"
                ? "delivery paid"
                : `delivery ${openOrder.delivery_payment_status}`}
            </p>
            {openOrder.cancellation_reason ? (
              <Alert>
                <AlertTitle>Cancellation reason</AlertTitle>
                <AlertDescription>{openOrder.cancellation_reason}</AlertDescription>
              </Alert>
            ) : null}
            {openOrder.manual_refund_status !== "not_required" ? (
              <Alert>
                <AlertTitle>Manual refund</AlertTitle>
                <AlertDescription>
                  {formatPrice(openOrder.refund_amount)} ·{" "}
                  {openOrder.manual_refund_status.replaceAll("_", " ")}
                </AlertDescription>
              </Alert>
            ) : null}
            {(openOrder.packages ?? []).length ? (
              <ul className="flex flex-col gap-2">
                {(openOrder.packages ?? []).map((pkg) => (
                  <li className="text-sm" key={pkg.supplier_id}>
                    <span className="font-medium">
                      {pkg.supplier_name ?? `Supplier ${shortId(pkg.supplier_id)}`}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {packageStatusLabel(pkg.status)}
                      {pkg.decline_reason ? ` · ${pkg.decline_reason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <DeliveryStatusCard
              status={openOrder.status}
              audience="admin"
              progress={{
                deliveryInitiated: isDeliveryInitiated(openOrder),
                parcelStatus: orderDeliveryStatus(openOrder),
              }}
            />
          </div>
        ) : null}
      </OrderDetailSheet>

      <AlertDialog
        open={Boolean(initiateTarget)}
        onOpenChange={(open) => {
          if (!open) setInitiateTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Initiate delivery for order #{initiateTarget ? shortId(initiateTarget.id) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This starts delivery and locks the order: nobody can cancel it from here on. You then
              keep the delivery status up to date.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Not yet</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirmInitiateDelivery}>
              Initiate delivery
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deliveryTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeliveryTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deliveryTarget
                ? `Mark order #${shortId(deliveryTarget.order.id)} ${deliveryStatusLabel(deliveryTarget.status).toLowerCase()}?`
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every parcel on this order moves to the next delivery step. Delivery status only moves
              forward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Not yet</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirmUpdateDelivery}>
              Confirm status
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(refundConfirmation)}
        onOpenChange={(open) => {
          if (!open) setRefundConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm manual refund</AlertDialogTitle>
            <AlertDialogDescription>
              {refundConfirmation
                ? `Confirm that the manual refund of ${formatPrice(refundConfirmation.refund_amount)} for order #${shortId(refundConfirmation.id)} has been paid?`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirmCompleteRefund}>
              Mark completed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(codConfirmation)}
        onOpenChange={(open) => {
          if (!open) setCodConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record cash collected</AlertDialogTitle>
            <AlertDialogDescription>
              {codConfirmation
                ? `Confirm that cash was collected for order #${shortId(codConfirmation.id)} and settled with SoukCart?`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirmCollectCod}>
              Record cash collected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminWorkspaceShell>
  );
}
