import { Check, Clock, Minus, ShoppingBag, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Brand } from "../../components/ui/Brand.tsx";
import {
  clearCart,
  completePayment,
  getSessionUserId,
  isRecentOrderSettled,
  loadLatestRecentOrder,
  paymentOutcome,
  paymentSuccessPath,
  PAYMENT_RETURN_KEY,
  queryPayment,
} from "./payment-return-api.ts";

type ResultState = "paid" | "failed" | "cancelled" | "pending" | "unknown";
type Outcome = {
  state: ResultState;
  orderId: string;
  hasSession: boolean;
  merchandisePaid: boolean;
};

const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 2500;

export function PaymentReturn() {
  const [outcome, setOutcome] = useState<Outcome>({
    state: "pending",
    orderId: "",
    hasSession: false,
    merchandisePaid: false,
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

    const finishPaid = async (orderId: string, merchandisePaid: boolean): Promise<boolean> => {
      const userId = await getSessionUserId();
      if (cancelled || !userId) return false;
      await clearCart(userId);
      if (cancelled) return false;
      window.location.assign(paymentSuccessPath({ orderId, merchandisePaid }));
      return true;
    };

    const settle = async () => {
      const { paid, orderId, merchandisePaid } = await completePayment(tranId, valId, status);
      if (cancelled) return;
      if (paid && (await finishPaid(orderId, merchandisePaid))) return;
      const userId = await getSessionUserId();
      set({
        state: paid ? "paid" : kind === "cancelled" ? "cancelled" : "failed",
        orderId,
        hasSession: Boolean(userId),
        merchandisePaid,
      });
    };

    const poll = async () => {
      const hasSession = Boolean(await getSessionUserId());
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        const { paymentStatus, deliveryPaymentStatus, orderId, paid } = await queryPayment(tranId);
        if (cancelled) return;
        if (paid) {
          const merchandisePaid = paymentStatus === "paid";
          if (await finishPaid(orderId, merchandisePaid)) return;
          set({ state: "paid", orderId, hasSession, merchandisePaid });
          return;
        }
        if (
          paymentStatus === "failed" ||
          paymentStatus === "cancelled" ||
          deliveryPaymentStatus === "failed" ||
          deliveryPaymentStatus === "cancelled"
        ) {
          set({
            state: kind === "cancelled" ? "cancelled" : "failed",
            orderId,
            hasSession,
            merchandisePaid: false,
          });
          return;
        }
        await sleep(POLL_INTERVAL_MS);
        if (cancelled) return;
      }
      set({ state: "pending", orderId: "", hasSession, merchandisePaid: false });
    };

    const reconcileLatest = async () => {
      const userId = await getSessionUserId();
      if (cancelled) return;
      if (!userId) {
        set({ state: "unknown", orderId: "", hasSession: false, merchandisePaid: false });
        return;
      }
      const order = await loadLatestRecentOrder(userId);
      if (cancelled) return;
      if (!order?.tran_id) {
        set({ state: "pending", orderId: "", hasSession: true, merchandisePaid: false });
        return;
      }
      if (isRecentOrderSettled(order)) {
        const merchandisePaid = order.payment_status === "paid";
        if (await finishPaid(order.id, merchandisePaid)) return;
        set({ state: "paid", orderId: order.id, hasSession: true, merchandisePaid });
        return;
      }
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        const { paymentStatus, deliveryPaymentStatus, orderId, paid } = await queryPayment(
          order.tran_id,
        );
        if (cancelled) return;
        const resolvedOrderId = orderId || order.id;
        if (paid) {
          const merchandisePaid = paymentStatus === "paid";
          if (await finishPaid(resolvedOrderId, merchandisePaid)) return;
          set({ state: "paid", orderId: resolvedOrderId, hasSession: true, merchandisePaid });
          return;
        }
        if (
          paymentStatus === "failed" ||
          paymentStatus === "cancelled" ||
          deliveryPaymentStatus === "failed" ||
          deliveryPaymentStatus === "cancelled"
        ) {
          set({
            state:
              paymentStatus === "cancelled" || deliveryPaymentStatus === "cancelled"
                ? "cancelled"
                : "failed",
            orderId: resolvedOrderId,
            hasSession: true,
            merchandisePaid: false,
          });
          return;
        }
        await sleep(POLL_INTERVAL_MS);
        if (cancelled) return;
      }
      set({ state: "pending", orderId: order.id, hasSession: true, merchandisePaid: false });
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
    <main className="min-h-svh bg-muted/30 p-4 sm:p-8">
      <div className="mx-auto flex min-h-[calc(100svh-2rem)] max-w-2xl flex-col gap-8 sm:min-h-[calc(100svh-4rem)]">
        <Brand />
        <div className="flex flex-1 items-center justify-center">
          <PaymentResultCard outcome={outcome} />
        </div>
      </div>
    </main>
  );
}

function resultAction(outcome: Outcome): { href: string; label: string } {
  const { state, orderId, hasSession, merchandisePaid } = outcome;
  if (state === "paid" && hasSession) {
    if (merchandisePaid && orderId) {
      return { href: `/retailer/orders/${orderId}/invoice`, label: "View invoice" };
    }
    return { href: "/retailer/orders", label: "View orders" };
  }
  if (hasSession) return { href: "/retailer/orders", label: "View orders" };
  return { href: "/", label: "Sign in" };
}

function PaymentResultCard({ outcome }: { outcome: Outcome }) {
  const { state } = outcome;
  const ResultIcon: LucideIcon =
    state === "paid"
      ? Check
      : state === "failed"
        ? Minus
        : state === "cancelled"
          ? Clock
          : ShoppingBag;
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
      ? outcome.merchandisePaid
        ? "Your order is with the suppliers."
        : "Delivery is paid. Pay for products in cash when your order arrives."
      : state === "failed" || state === "cancelled"
        ? "No charge was made. You can try again from your cart."
        : state === "pending"
          ? "Your payment may still be processing. Check your orders in a moment."
          : "No payment details were received. Sign in to check your orders.";
  const action = resultAction(outcome);

  return (
    <Empty role="status" aria-live="polite" data-payment-result>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ResultIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{copy}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <a href={action.href}>{action.label}</a>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
