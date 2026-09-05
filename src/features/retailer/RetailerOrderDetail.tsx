import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  MessageSquare,
  RefreshCw,
  ShoppingBag,
  Trash2,
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
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { shortId } from "../orders/order-presentation.tsx";
import { formatPrice } from "../workspace/format.ts";
import { RetailerOrderStatusView } from "./RetailerOrderTracker.tsx";
import { invoiceIsAvailable } from "./retailer-invoice-api.ts";
import {
  canCancelOrder,
  canRequestCodDeliveryRefund,
  clearCart,
  confirmOrderDelivery,
  loadCartCount,
  loadRetailerOrder,
  needsGatewayPaymentVerification,
  queryPaymentStatus,
  requestCodDeliveryRefund,
  requestOrderCancellation,
  type RetailerOrder,
} from "./retailer-orders-api.ts";
import { needsDeliveryConfirmation } from "./retailer-dashboard-api.ts";
import { useRetailerOrderChanges } from "./retailer-realtime.ts";
import { reorderOrderItems } from "./retailer-cart-api.ts";
import { buildShipmentCards } from "./retailer-dashboard-api.ts";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";

type ConfirmAction =
  | { kind: "verify-delivery"; order: RetailerOrder }
  | { kind: "cancel"; order: RetailerOrder }
  | { kind: "delivery-refund"; order: RetailerOrder };

type Notice = { message: string; state: NoticeState } | null;

function cancelHint(order: RetailerOrder): string {
  const paidOnline = order.payment_method === "online" && order.payment_status === "paid";
  const prepaidDelivery =
    order.payment_method === "cod" && order.delivery_payment_status === "paid";
  if (paidOnline) {
    return "If the suppliers approve, the full advance payment is refunded by the admin team.";
  }
  if (prepaidDelivery) {
    return "If the suppliers approve, the prepaid delivery charge is refunded by the admin team.";
  }
  return "";
}

export function RetailerOrderDetail({ orderId }: { orderId: string }) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer/orders/$orderId" });
  const [order, setOrder] = useState<RetailerOrder | null | undefined>(undefined);
  const [cartCount, setCartCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

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

    void Promise.all([loadRetailerOrder(retailerId, orderId), loadCartCount(retailerId)])
      .then(([nextOrder, nextCartCount]) => {
        if (!current) return;
        setOrder(nextOrder);
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
  }, [loadVersion, orderId, retailerId]);

  if (state.status !== "retailer") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || state.profile.email;
  const inTransitCount = order ? buildShipmentCards([order]).length : undefined;

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Retailer workspace"
        title="We could not load this order."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const onVerifyPayment = () => {
    if (!order?.tran_id) return;
    setBusy(true);
    void queryPaymentStatus(order.tran_id).then(async (result) => {
      if (result === "paid" || result === "failed" || result === "cancelled") {
        if (result === "paid") {
          await clearCart(retailerId);
          setCartCount(0);
          if (order.payment_method === "cod") {
            setOrder({ ...order, delivery_payment_status: "paid" });
          } else {
            setOrder({
              ...order,
              payment_status: result,
              delivery_payment_status: "paid",
            });
          }
        } else if (order.payment_method === "cod") {
          setOrder({ ...order, delivery_payment_status: result });
        } else {
          setOrder({
            ...order,
            payment_status: result,
            delivery_payment_status: result,
          });
        }
        setBusy(false);
      } else {
        setBusy(false);
        setNotice({
          message: "Payment not found yet. Please try again in a moment.",
          state: "info",
        });
      }
    });
  };

  const runVerifyDelivery = (target: RetailerOrder) => {
    setBusy(true);
    void confirmOrderDelivery(target.id)
      .then((verifiedAt) => {
        setOrder({ ...target, delivery_verified_at: verifiedAt });
        setNotice({
          message: `Delivery of order #${shortId(target.id)} was verified.`,
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
      .finally(() => setBusy(false));
  };

  const runCancel = (target: RetailerOrder) => {
    setBusy(true);
    void requestOrderCancellation(target.id)
      .then(() => {
        setOrder({
          ...target,
          cancel_requested: true,
          cancellation_initiator: "retailer",
        });
        setNotice({
          message: `Cancellation of order #${shortId(target.id)} was requested.`,
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
      .finally(() => setBusy(false));
  };

  const onReorder = () => {
    if (!order) return;
    setBusy(true);
    void reorderOrderItems(
      retailerId,
      order.items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
    )
      .then(async (outcome) => {
        if (!outcome.lines) {
          setNotice({
            message: "None of these items are orderable right now.",
            state: "info",
          });
          return;
        }
        setCartCount(await loadCartCount(retailerId));
        setNotice({
          message: `Added ${outcome.lines} item${outcome.lines === 1 ? "" : "s"} to your cart.`,
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
      .finally(() => setBusy(false));
  };

  const runDeliveryRefund = (target: RetailerOrder) => {
    setBusy(true);
    void requestCodDeliveryRefund(target.id)
      .then((result) => {
        setOrder({
          ...target,
          manual_refund_status: "pending",
          refund_amount: result.refundAmount,
        });
        setNotice({
          message: `Delivery refund of ${formatPrice(result.refundAmount)} was requested.`,
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
      .finally(() => setBusy(false));
  };

  const actions =
    order && order !== undefined ? (
      <>
        {needsGatewayPaymentVerification(order) ? (
          <Button type="button" variant="outline" disabled={busy} onClick={onVerifyPayment}>
            {busy ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
            Verify payment
          </Button>
        ) : null}
        {needsDeliveryConfirmation(order) ? (
          <Button
            type="button"
            disabled={busy}
            onClick={() => setConfirmAction({ kind: "verify-delivery", order })}
          >
            <Check data-icon="inline-start" />
            Verify delivery
          </Button>
        ) : null}
        {canCancelOrder(order) ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmAction({ kind: "cancel", order })}
          >
            <Trash2 data-icon="inline-start" />
            Request cancellation
          </Button>
        ) : null}
        {canRequestCodDeliveryRefund(order) ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmAction({ kind: "delivery-refund", order })}
          >
            Request delivery refund
          </Button>
        ) : null}
        {order.status === "delivered" ? (
          <Button type="button" variant="outline" disabled={busy} onClick={onReorder}>
            <ShoppingBag data-icon="inline-start" />
            Reorder items
          </Button>
        ) : null}
        {invoiceIsAvailable(order) ? (
          <Button asChild variant="outline">
            <RouterLink to="/retailer/orders/$orderId/invoice" params={{ orderId: order.id }}>
              <Download data-icon="inline-start" />
              Download invoice
            </RouterLink>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <RouterLink to="/retailer/complaints" search={{ order: order.id }}>
            <MessageSquare data-icon="inline-start" />
            Contact support
          </RouterLink>
        </Button>
      </>
    ) : null;

  return (
    <RetailerWorkspaceShell
      section="orders"
      userName={userName}
      userEmail={state.profile.email}
      cartCount={cartCount}
      inTransitCount={inTransitCount}
      onLogout={onLogout}
    >
      <div className="flex flex-col gap-6">
        <Button asChild variant="ghost" className="self-start">
          <RouterLink to="/retailer/orders">
            <ArrowLeft data-icon="inline-start" />
            Back to orders
          </RouterLink>
        </Button>
        <InlineNotice message={notice?.message} state={notice?.state} />
        {order === undefined ? (
          <LoadingState title="Loading your order…" />
        ) : order === null ? (
          <EmptyState
            icon={ShoppingBag}
            title="We could not find that order"
            copy="It may have been removed, or you may not have access to it."
            action={
              <Button asChild>
                <RouterLink to="/retailer/orders">Back to orders</RouterLink>
              </Button>
            }
          />
        ) : (
          <RetailerOrderStatusView order={order} actions={actions} />
        )}
      </div>

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
                    Confirm the parcel arrived in good condition. This closes the order.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Not yet</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      const target = confirmAction.order;
                      setConfirmAction(null);
                      runVerifyDelivery(target);
                    }}
                  >
                    Verify delivery
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            ) : confirmAction.kind === "delivery-refund" ? (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Request a delivery refund for order #{shortId(confirmAction.order.id)}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This requests a refund of the {formatPrice(confirmAction.order.delivery_charge)}{" "}
                    prepaid delivery charge.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep as is</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      const target = confirmAction.order;
                      setConfirmAction(null);
                      runDeliveryRefund(target);
                    }}
                  >
                    Request refund
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            ) : (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Request cancellation of order #{shortId(confirmAction.order.id)}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {cancelHint(confirmAction.order)} The suppliers review every cancellation before
                    anything is cancelled.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep order</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      const target = confirmAction.order;
                      setConfirmAction(null);
                      runCancel(target);
                    }}
                  >
                    Request cancellation
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            )}
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
    </RetailerWorkspaceShell>
  );
}
