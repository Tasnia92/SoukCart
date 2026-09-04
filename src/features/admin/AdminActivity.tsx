import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Activity, RefreshCw, Search } from "lucide-react";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
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
  DeliveryDetails,
  OrderRow,
  PaymentBadge,
  shortId,
  StatusBadge,
  statusLabel,
} from "../orders/order-presentation.tsx";
import { formatDate, formatPrice, initials } from "../workspace/format.ts";
import { recordIdFromHash, searchParam } from "../workspace/search.ts";
import { AdminWorkspaceShell } from "./admin-workspace-shell.tsx";
import { adminOrderViewMeta } from "./admin-nav.ts";
import {
  canFulfillOrder,
  collectCodPayment,
  completeManualRefund,
  filterActivityOrders,
  loadAdminActivity,
  needsCodCollection,
  parseAdminOrderView,
  updateOrderStatus,
  type ActivityOrder,
  type ActivityResponse,
  type CancellationCharges,
} from "./admin-activity-api.ts";

type AdminActivityProps = {
  loadActivity?: () => Promise<ActivityResponse>;
};

type Notice = { message: string; state: NoticeState } | null;

type ChargeDraft = {
  order: ActivityOrder;
  status: string;
  platformCharge: string;
  deliveryCharge: string;
};

type PendingStatusChange = {
  order: ActivityOrder;
  status: string;
  charges: CancellationCharges;
  approved: boolean;
  rejecting: boolean;
  refundAmount: number;
  message: string;
};

function nextStatuses(order: ActivityOrder): string[] {
  const unpaidOnline = !canFulfillOrder(order);
  switch (order.status) {
    case "pending":
      return unpaidOnline ? ["pending", "cancelled"] : ["pending", "confirmed", "cancelled"];
    case "confirmed":
      return unpaidOnline ? ["confirmed", "cancelled"] : ["confirmed", "shipped", "cancelled"];
    case "shipped":
      return unpaidOnline ? ["shipped", "cancelled"] : ["shipped", "delivered", "cancelled"];
    case "delivered":
      return ["delivered", "cancelled"];
    default:
      return ["cancelled"];
  }
}

function parseCharge(value: string): number {
  if (!value.trim()) return NaN;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : NaN;
}

function initialCharge(value: number): string {
  return value > 0 ? value.toFixed(2) : "";
}

function OrderFlag({ children }: { children: string }) {
  return <Badge variant="outline">{children}</Badge>;
}

export function AdminActivity({ loadActivity = loadAdminActivity }: AdminActivityProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const location = useRouterState({ select: (routerState) => routerState.location });
  const focusedOrderId =
    searchParam(location.searchStr, "order") ?? recordIdFromHash(location.hash, "order");
  const orderView = parseAdminOrderView(searchParam(location.searchStr, "view"));
  const viewMeta = adminOrderViewMeta(orderView);
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [chargeDraft, setChargeDraft] = useState<ChargeDraft | null>(null);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<PendingStatusChange | null>(null);
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
    if (!focusedOrderId || !data) return;
    document.getElementById(`order-${focusedOrderId}`)?.scrollIntoView({ block: "center" });
  }, [data, focusedOrderId]);

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

  const queueStatusConfirmation = (
    order: ActivityOrder,
    status: string,
    charges: CancellationCharges,
  ) => {
    const approved = status === "cancelled" && order.status !== "cancelled";
    const rejecting = order.cancel_requested && status === order.status;
    const refundAmount =
      order.payment_method === "online" && order.payment_status === "paid"
        ? order.cancellation_initiator === "supplier"
          ? order.total
          : Math.max(order.total - charges.platformCharge - charges.deliveryCharge, 0)
        : 0;
    const message = rejecting
      ? `Reject the cancellation request for order #${shortId(order.id)}?`
      : approved
        ? `Cancel order #${shortId(order.id)} for ${order.retailer_name}?${refundAmount ? ` Record a pending manual refund of ${formatPrice(refundAmount)}.` : ""}`
        : `Set order #${shortId(order.id)} to ${statusLabel(status)}?`;

    setPendingStatusChange({
      order,
      status,
      charges,
      approved,
      rejecting,
      refundAmount,
      message,
    });
  };

  const requestStatusChange = (order: ActivityOrder, status: string) => {
    const approved = status === "cancelled" && order.status !== "cancelled";
    const needsCharges =
      approved &&
      order.payment_method === "online" &&
      order.payment_status === "paid" &&
      order.cancellation_initiator !== "supplier";

    if (needsCharges) {
      setChargeError(null);
      setChargeDraft({
        order,
        status,
        platformCharge: initialCharge(order.platform_charge),
        deliveryCharge: initialCharge(order.delivery_charge),
      });
      return;
    }

    queueStatusConfirmation(order, status, { platformCharge: 0, deliveryCharge: 0 });
  };

  const onSubmitCharges = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!chargeDraft) return;

    const platformCharge = parseCharge(chargeDraft.platformCharge);
    const deliveryCharge = parseCharge(chargeDraft.deliveryCharge);
    if (!Number.isFinite(platformCharge) || !Number.isFinite(deliveryCharge)) {
      const message = "Enter valid non-negative cancellation charges.";
      setChargeError(message);
      setNotice({ message, state: "error" });
      return;
    }
    if (platformCharge + deliveryCharge > chargeDraft.order.total) {
      const message = "Cancellation charges cannot exceed the paid order total.";
      setChargeError(message);
      setNotice({ message, state: "error" });
      return;
    }

    const { order, status } = chargeDraft;
    setChargeDraft(null);
    setChargeError(null);
    queueStatusConfirmation(order, status, { platformCharge, deliveryCharge });
  };

  const confirmStatusChange = () => {
    if (!pendingStatusChange) return;
    const { order, status, charges, approved, rejecting, refundAmount } = pendingStatusChange;
    setPendingStatusChange(null);
    setBusyId(order.id);
    void updateOrderStatus(order.id, status, charges)
      .then(() => {
        setNotice(
          rejecting
            ? {
                message: `Cancellation request for #${shortId(order.id)} was rejected.`,
                state: "info",
              }
            : approved
              ? {
                  message: refundAmount
                    ? `Order #${shortId(order.id)} was cancelled. Manual refund ${formatPrice(refundAmount)} is pending.`
                    : `Order #${shortId(order.id)} was cancelled. No advance refund is required.`,
                  state: "success",
                }
              : {
                  message: `Order #${shortId(order.id)} is now ${statusLabel(status)}.`,
                  state: "success",
                },
        );
        setLoadVersion((version) => version + 1);
      })
      .catch((statusError: unknown) => {
        setNotice({
          message:
            statusError instanceof Error
              ? statusError.message
              : "The order status could not be updated.",
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

  const onSelectChange = (order: ActivityOrder, value: string) => {
    if (value === order.status && !order.cancel_requested) return;
    requestStatusChange(order, value);
  };

  const orders = data?.orders ?? null;
  const summary = data?.summary ?? null;
  const filtered = orders ? filterActivityOrders(orders, searchTerm, shortId, orderView) : [];

  return (
    <AdminWorkspaceShell
      activePath="/admin/activity"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Orders"
        title={viewMeta.title}
        copy={viewMeta.copy}
        actions={
          <Button type="button" variant="ghost" disabled={loading} onClick={retry}>
            <RefreshCw data-icon="inline-start" />
            Refresh
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
              <Table className="min-w-[72rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Placed</TableHead>
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
                  {filtered.length ? (
                    filtered.map((order) => (
                      <OrderRow
                        key={order.id}
                        colSpan={8}
                        rowId={`order-${order.id}`}
                        defaultOpen={order.id === focusedOrderId}
                        highlight={order.id === focusedOrderId}
                        toggleLabel={`Toggle lines for order #${shortId(order.id)}`}
                        summaryCells={
                          <>
                            <TableCell>
                              <strong className="font-medium">#{shortId(order.id)}</strong>
                            </TableCell>
                            <TableCell>{formatDate(order.created_at)}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar size="sm">
                                  <AvatarFallback>{initials(order.retailer_name)}</AvatarFallback>
                                </Avatar>
                                <span className="flex min-w-0 flex-col gap-1">
                                  <strong className="truncate font-medium">
                                    {order.retailer_name}
                                  </strong>
                                  <small className="truncate text-xs text-muted-foreground">
                                    {order.retailer_email}
                                  </small>
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {order.lines.reduce((sum, line) => sum + line.quantity, 0)}
                            </TableCell>
                            <TableCell>
                              <strong className="font-medium">{formatPrice(order.total)}</strong>
                            </TableCell>
                            <TableCell>
                              <PaymentBadge
                                paymentStatus={order.payment_status}
                                paymentMethod={order.payment_method}
                                showFailed
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex min-w-48 flex-col items-start gap-1">
                                <StatusBadge status={order.status} />
                                {order.cancel_requested ? (
                                  <OrderFlag>
                                    {`Cancel requested by ${order.cancellation_initiator}`}
                                  </OrderFlag>
                                ) : null}
                                {order.delivery_verified_at ? (
                                  <OrderFlag>Delivery verified</OrderFlag>
                                ) : null}
                                {order.manual_refund_status === "review_required" ? (
                                  <OrderFlag>Refund review required</OrderFlag>
                                ) : null}
                                {order.manual_refund_status === "pending" ? (
                                  <OrderFlag>Refund pending</OrderFlag>
                                ) : null}
                                {order.manual_refund_status === "completed" ? (
                                  <OrderFlag>Refund completed</OrderFlag>
                                ) : null}
                              </div>
                            </TableCell>
                          </>
                        }
                        detail={
                          <div className="flex flex-col gap-4">
                            <ItemGroup aria-label={`Order lines for #${shortId(order.id)}`}>
                              {order.lines.map((line) => (
                                <Item key={line.id} size="sm">
                                  <ItemContent>
                                    <ItemTitle>{line.product_name}</ItemTitle>
                                    <ItemDescription>
                                      from {line.supplier_name ?? "an unassigned supplier"}
                                    </ItemDescription>
                                  </ItemContent>
                                  <ItemActions className="flex-wrap">
                                    <span className="text-sm text-muted-foreground">
                                      {line.quantity} × {formatPrice(line.unit_price)}
                                    </span>
                                    <strong className="text-sm font-medium">
                                      {formatPrice(line.amount)}
                                    </strong>
                                  </ItemActions>
                                </Item>
                              ))}
                            </ItemGroup>
                            <DeliveryDetails
                              phone={order.delivery_phone}
                              address={order.delivery_address}
                              city={order.delivery_city}
                              postcode={order.delivery_postcode}
                            />
                            {order.cancellation_reason ? (
                              <Alert>
                                <AlertTitle>Cancellation reason</AlertTitle>
                                <AlertDescription>{order.cancellation_reason}</AlertDescription>
                              </Alert>
                            ) : null}
                            {order.manual_refund_status !== "not_required" ? (
                              <Alert>
                                <AlertTitle>Manual refund</AlertTitle>
                                <AlertDescription>
                                  {formatPrice(order.refund_amount)} · platform charge{" "}
                                  {formatPrice(order.platform_charge)} · delivery charge{" "}
                                  {formatPrice(order.delivery_charge)}
                                </AlertDescription>
                              </Alert>
                            ) : null}
                            <Card size="sm">
                              <CardHeader>
                                <CardTitle>Admin controls</CardTitle>
                                <CardDescription>
                                  Update status, review cancellation requests, and record refunds.
                                </CardDescription>
                              </CardHeader>
                              <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                                <Field className="max-w-xs">
                                  <FieldLabel htmlFor={`order-status-${order.id}`}>
                                    Status
                                  </FieldLabel>
                                  <Select
                                    value={order.status}
                                    disabled={busyId === order.id}
                                    onValueChange={(value) => onSelectChange(order, value)}
                                  >
                                    <SelectTrigger
                                      id={`order-status-${order.id}`}
                                      className="w-full min-w-32"
                                      aria-label={`Order status for #${shortId(order.id)}`}
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        {nextStatuses(order).map((value) => (
                                          <SelectItem value={value} key={value}>
                                            {statusLabel(value)}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                </Field>
                                <div className="flex flex-wrap items-center gap-2">
                                  {order.cancel_requested ? (
                                    <>
                                      <OrderFlag>
                                        {`Cancellation requested by ${order.cancellation_initiator}`}
                                      </OrderFlag>
                                      <Button
                                        variant="destructive"
                                        size="sm"
                                        type="button"
                                        disabled={busyId === order.id}
                                        onClick={() => requestStatusChange(order, "cancelled")}
                                      >
                                        Approve &amp; cancel
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        type="button"
                                        disabled={busyId === order.id}
                                        onClick={() => requestStatusChange(order, order.status)}
                                      >
                                        Reject request
                                      </Button>
                                    </>
                                  ) : null}
                                  {needsCodCollection(order) ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={busyId === order.id}
                                      onClick={() => setCodConfirmation(order)}
                                    >
                                      Record cash collected
                                    </Button>
                                  ) : null}
                                  {order.manual_refund_status === "pending" ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      disabled={busyId === order.id}
                                      onClick={() => setRefundConfirmation(order)}
                                    >
                                      Mark manual refund completed
                                    </Button>
                                  ) : null}
                                </div>
                              </CardContent>
                            </Card>
                          </div>
                        }
                      />
                    ))
                  ) : (
                    <TableRow>
                      <TableCell className="p-0" colSpan={8}>
                        <EmptyState
                          icon={Search}
                          title="No matching orders"
                          copy={
                            orderView === "all"
                              ? "Try a different retailer, supplier, or product."
                              : "Nothing in this order view right now."
                          }
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableShell>
          ) : (
            <EmptyState icon={Activity} title="No orders yet" copy="New orders show up here." />
          )}
        </>
      ) : (
        <LoadingState title="Loading order activity…" />
      )}

      <Dialog
        open={Boolean(chargeDraft)}
        onOpenChange={(open) => {
          if (!open) {
            setChargeDraft(null);
            setChargeError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancellation charges</DialogTitle>
            <DialogDescription>
              Enter the charges to deduct before calculating the retailer&apos;s manual refund.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmitCharges} noValidate>
            <FieldGroup>
              <Field data-invalid={Boolean(chargeError) || undefined}>
                <FieldLabel htmlFor="platform-cancellation-charge">
                  Platform charge to deduct (BDT)
                </FieldLabel>
                <Input
                  id="platform-cancellation-charge"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={chargeDraft?.platformCharge ?? ""}
                  aria-invalid={Boolean(chargeError) || undefined}
                  onChange={(event) =>
                    setChargeDraft((current) =>
                      current ? { ...current, platformCharge: event.target.value } : current,
                    )
                  }
                />
              </Field>
              <Field data-invalid={Boolean(chargeError) || undefined}>
                <FieldLabel htmlFor="delivery-cancellation-charge">
                  Delivery charge to deduct (BDT)
                </FieldLabel>
                <Input
                  id="delivery-cancellation-charge"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={chargeDraft?.deliveryCharge ?? ""}
                  aria-invalid={Boolean(chargeError) || undefined}
                  onChange={(event) =>
                    setChargeDraft((current) =>
                      current ? { ...current, deliveryCharge: event.target.value } : current,
                    )
                  }
                />
                {chargeError ? <FieldError>{chargeError}</FieldError> : null}
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setChargeDraft(null);
                  setChargeError(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Continue</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingStatusChange)}
        onOpenChange={(open) => {
          if (!open) setPendingStatusChange(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm order status change</AlertDialogTitle>
            <AlertDialogDescription>{pendingStatusChange?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant={pendingStatusChange?.approved ? "destructive" : "default"}
              onClick={confirmStatusChange}
            >
              Confirm
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
                ? `Confirm that the delivery partner collected cash for order #${shortId(codConfirmation.id)} and settled it with SoukCart? The retailer can then download an invoice.`
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
