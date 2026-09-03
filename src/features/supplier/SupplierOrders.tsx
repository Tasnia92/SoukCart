import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, Layers, Package, Search } from "lucide-react";
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
import { OrderRow, PaymentBadge, shortId, StatusBadge } from "../orders/order-presentation.tsx";
import { formatDate, formatPrice, initials } from "../workspace/format.ts";
import { RouterLink, WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import { supplierNavItems } from "./supplier-shared.tsx";
import {
  acceptSupplierOrder,
  canSupplierCancel,
  filterSupplierOrders,
  loadSupplierOrders,
  requestSupplierCancellation,
  type SupplierOrder,
} from "./supplier-orders-api.ts";

type SupplierOrdersProps = {
  loadOrders?: () => Promise<SupplierOrder[]>;
};

type Notice = { message: string; state: NoticeState } | null;
type OrderFilter = "all" | "action" | "accepted" | "cancelled";

function needsAction(order: SupplierOrder): boolean {
  return (!order.accepted_at && order.status === "pending") || order.cancel_requested;
}

function matchesFilter(order: SupplierOrder, filter: OrderFilter): boolean {
  if (filter === "all") return true;
  if (filter === "action") return needsAction(order);
  if (filter === "accepted") return Boolean(order.accepted_at) && order.status !== "cancelled";
  return order.status === "cancelled";
}

function OrderActions({
  order,
  disabled,
  onAccept,
  onCancel,
}: {
  order: SupplierOrder;
  disabled: boolean;
  onAccept: (order: SupplierOrder) => void;
  onCancel: (order: SupplierOrder) => void;
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
  if (order.status === "delivered" && order.delivery_verified_at) {
    return (
      <p className="text-sm text-muted-foreground">
        Delivery verified · supplier cancellation is closed
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!order.accepted_at && order.status === "pending" ? (
        <Button size="sm" type="button" disabled={disabled} onClick={() => onAccept(order)}>
          <Check data-icon="inline-start" />
          Accept order
        </Button>
      ) : order.accepted_at ? (
        <p className="text-sm text-muted-foreground">Accepted {formatDate(order.accepted_at)}</p>
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

export function SupplierOrders({ loadOrders = loadSupplierOrders }: SupplierOrdersProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/orders" });
  const [orders, setOrders] = useState<SupplierOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [acceptTarget, setAcceptTarget] = useState<SupplierOrder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SupplierOrder | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelInvalid, setCancelInvalid] = useState(false);

  const isSeller = state.status === "seller";

  useEffect(() => {
    if (!isSeller) return;
    let current = true;
    setError(null);

    void loadOrders()
      .then((nextOrders) => {
        if (current) setOrders(nextOrders);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [isSeller, loadOrders, loadVersion]);

  const counts = useMemo(() => {
    const list = orders ?? [];
    return {
      all: list.length,
      action: list.filter(needsAction).length,
      accepted: list.filter((order) => Boolean(order.accepted_at) && order.status !== "cancelled")
        .length,
      cancelled: list.filter((order) => order.status === "cancelled").length,
    };
  }, [orders]);

  if (state.status !== "seller") return null;

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
        eyebrow="Supplier workspace"
        title="We could not load your orders."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const confirmAccept = () => {
    const order = acceptTarget;
    if (!order) return;
    setAcceptTarget(null);
    setBusyId(order.id);
    void acceptSupplierOrder(order.id)
      .then((acceptedAt) => {
        setOrders(
          (prev) =>
            prev?.map((current) =>
              current.id === order.id ? { ...current, accepted_at: acceptedAt } : current,
            ) ?? prev,
        );
        setNotice({
          message: `Order #${shortId(order.id)} was accepted. The admin team will manage its status.`,
          state: "success",
        });
      })
      .catch((acceptError: unknown) => {
        setNotice({
          message:
            acceptError instanceof Error ? acceptError.message : "The order could not be accepted.",
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
        setOrders(
          (prev) =>
            prev?.map((current) =>
              current.id === order.id
                ? {
                    ...current,
                    cancel_requested: true,
                    cancellation_initiator: "supplier",
                    cancellation_reason: reason,
                  }
                : current,
            ) ?? prev,
        );
        setNotice({
          message: `Cancellation of order #${shortId(order.id)} was requested. The retailer, admin, and other suppliers were notified.`,
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

  const searched = orders ? filterSupplierOrders(orders, searchTerm, shortId) : [];
  const filtered = searched.filter((order) => matchesFilter(order, filter));

  return (
    <WorkspaceShell
      navigationLabel="Supplier navigation"
      items={supplierNavItems("orders")}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        title="Orders"
        copy="Accept incoming orders or request cancellation before delivery is verified. The admin completes all refunds manually."
        actions={
          <Button asChild variant="outline">
            <RouterLink to="/supplier/stock">
              <Layers data-icon="inline-start" />
              Manage stock
            </RouterLink>
          </Button>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {orders ? (
        orders.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Fulfillment</CardTitle>
              <CardDescription>Orders that include your products</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Tabs value={filter} onValueChange={(value) => setFilter(value as OrderFilter)}>
                <TabsList>
                  <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
                  <TabsTrigger value="action">Needs action ({counts.action})</TabsTrigger>
                  <TabsTrigger value="accepted">Accepted ({counts.accepted})</TabsTrigger>
                  <TabsTrigger value="cancelled">Cancelled ({counts.cancelled})</TabsTrigger>
                </TabsList>
              </Tabs>
              <SearchToolbar
                label="Search orders"
                placeholder="Search orders"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                result={`${filtered.length} of ${orders.length} orders`}
              />
              {filtered.length ? (
                <Table>
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
                    {filtered.map((order) => (
                      <OrderRow
                        key={order.id}
                        colSpan={8}
                        toggleLabel={`Toggle lines for order #${shortId(order.id)}`}
                        summaryCells={
                          <>
                            <TableCell>
                              <span className="font-medium">#{shortId(order.id)}</span>
                            </TableCell>
                            <TableCell>{formatDate(order.created_at)}</TableCell>
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
                                {order.accepted_at ? (
                                  <Badge variant="outline">Accepted</Badge>
                                ) : null}
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
                            <OrderActions
                              order={order}
                              disabled={busyId === order.id}
                              onAccept={setAcceptTarget}
                              onCancel={(next) => {
                                setCancelReason("");
                                setCancelInvalid(false);
                                setCancelTarget(next);
                              }}
                            />
                          </div>
                        }
                      />
                    ))}
                  </TableBody>
                </Table>
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
        open={acceptTarget !== null}
        onOpenChange={(open) => {
          if (!open) setAcceptTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Accept order #{acceptTarget ? shortId(acceptTarget.id) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {acceptTarget
                ? `Accept the order from ${acceptTarget.retailer_name}. The admin team will manage its status after you accept.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirmAccept}>
              Accept order
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
    </WorkspaceShell>
  );
}
