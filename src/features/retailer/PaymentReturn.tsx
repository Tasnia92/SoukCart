import { useEffect, useState } from "react";
import { Brand } from "../../components/ui/Brand.tsx";
import { Icon, type IconName } from "../../components/ui/Icon.tsx";
import {
  clearCart,
  completePayment,
  getSessionUserId,
  loadLatestRecentOrder,
  paymentOutcome,
  PAYMENT_RETURN_KEY,
  queryPayment,
} from "./payment-return-api.ts";

type ResultState = "paid" | "failed" | "cancelled" | "pending" | "unknown";
type Outcome = { state: ResultState; orderId: string; hasSession: boolean };

const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 2500;

export function PaymentReturn() {
  const [outcome, setOutcome] = useState<Outcome>({
    state: "pending",
    orderId: "",
    hasSession: false,
  });

  useEffect(() => {
    sessionStorage.removeItem(PAYMENT_RETURN_KEY);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });
    const set = (next: Outcome) => {
      if (!cancelled) setOutcome(next);
    };

    const params = new URLSearchParams(window.location.search);
    const status = (params.get("status") ?? "").toUpperCase();
    const tranId = params.get("tran_id") ?? "";
    const valId = params.get("val_id") ?? "";
    const kind = paymentOutcome(status);

    const gotoInvoice = async (orderId: string): Promise<boolean> => {
      const userId = await getSessionUserId();
      if (cancelled || !userId) return false;
      await clearCart(userId);
      if (cancelled || !orderId) return false;
      window.location.assign(`/retailer/orders/${orderId}/invoice`);
      return true;
    };

    const settle = async () => {
      const { paid, orderId } = await completePayment(tranId, valId, status);
      if (cancelled) return;
      if (paid && (await gotoInvoice(orderId))) return;
      const userId = await getSessionUserId();
      set({
        state: paid ? "paid" : kind === "cancelled" ? "cancelled" : "failed",
        orderId,
        hasSession: Boolean(userId),
      });
    };

    const poll = async () => {
      const hasSession = Boolean(await getSessionUserId());
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        const { paymentStatus, orderId } = await queryPayment(tranId);
        if (cancelled) return;
        if (paymentStatus === "paid") {
          if (await gotoInvoice(orderId)) return;
          set({ state: "paid", orderId, hasSession });
          return;
        }
        if (paymentStatus === "failed" || paymentStatus === "cancelled") {
          set({ state: kind === "cancelled" ? "cancelled" : "failed", orderId, hasSession });
          return;
        }
        await sleep(POLL_INTERVAL_MS);
        if (cancelled) return;
      }
      set({ state: "pending", orderId: "", hasSession });
    };

    const reconcileLatest = async () => {
      const userId = await getSessionUserId();
      if (cancelled) return;
      if (!userId) {
        set({ state: "unknown", orderId: "", hasSession: false });
        return;
      }
      const order = await loadLatestRecentOrder(userId);
      if (cancelled) return;
      if (!order?.tran_id) {
        set({ state: "pending", orderId: "", hasSession: true });
        return;
      }
      if (order.payment_status === "paid") {
        if (await gotoInvoice(order.id)) return;
        set({ state: "paid", orderId: order.id, hasSession: true });
        return;
      }
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        const { paymentStatus, orderId } = await queryPayment(order.tran_id);
        if (cancelled) return;
        const resolvedOrderId = orderId || order.id;
        if (paymentStatus === "paid") {
          if (await gotoInvoice(resolvedOrderId)) return;
          set({ state: "paid", orderId: resolvedOrderId, hasSession: true });
          return;
        }
        if (paymentStatus === "failed" || paymentStatus === "cancelled") {
          set({
            state: paymentStatus === "cancelled" ? "cancelled" : "failed",
            orderId: resolvedOrderId,
            hasSession: true,
          });
          return;
        }
        await sleep(POLL_INTERVAL_MS);
        if (cancelled) return;
      }
      set({ state: "pending", orderId: order.id, hasSession: true });
    };

    const run = () => {
      if (tranId && valId) return settle();
      if (tranId) return poll();
      return reconcileLatest();
    };

    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="plain-screen">
      <Brand />
      <PaymentResultCard outcome={outcome} />
    </div>
  );
}

function resultAction(outcome: Outcome): { href: string; label: string } {
  const { state, orderId, hasSession } = outcome;
  if (state === "paid" && orderId && hasSession) {
    return { href: `/retailer/orders/${orderId}/invoice`, label: "View invoice" };
  }
  if (hasSession) return { href: "/retailer/orders", label: "View orders" };
  return { href: "/", label: "Sign in" };
}

function PaymentResultCard({ outcome }: { outcome: Outcome }) {
  const { state } = outcome;
  const icon: IconName =
    state === "paid"
      ? "check"
      : state === "failed"
        ? "minus"
        : state === "cancelled"
          ? "clock"
          : "bag";
  const title =
    state === "paid"
      ? "Payment received"
      : state === "failed"
        ? "Payment failed"
        : state === "cancelled"
          ? "Payment cancelled"
          : state === "pending"
            ? "Confirming your payment…"
            : "Payment result";
  const copy =
    state === "paid"
      ? "Your order is with the suppliers."
      : state === "failed" || state === "cancelled"
        ? "No charge was made. You can try again from your cart."
        : state === "pending"
          ? "Your payment may still be processing. Check your orders in a moment."
          : "No payment details were received. Sign in to check your orders.";
  const action = resultAction(outcome);

  return (
    <div className="rt-empty-card" role="status" aria-live="polite" data-payment-result>
      <span className={`rt-empty-icon${state === "paid" ? " is-success" : ""}`}>
        <Icon name={icon} />
      </span>
      <strong>{title}</strong>
      <span>{copy}</span>
      <a className="button button-primary" href={action.href}>
        <span>{action.label}</span>
      </a>
    </div>
  );
}
