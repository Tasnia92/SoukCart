import { useRouterState } from "@tanstack/react-router";
import {
  Check,
  Clock,
  House,
  MessageSquare,
  Minus,
  Package,
  ShoppingBag,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Brand } from "../../components/ui/Brand.tsx";
import { PageHeader } from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
import {
  clearCart,
  completePayment,
  getSessionUserId,
  paymentSuccessPath,
} from "./payment-return-api.ts";
import { RETAILER_NOTICE_KEY } from "./retailer-flash.ts";

type CheckoutKind = "success" | "failed" | "cancelled";

type Card = { ok: boolean; kind: CheckoutKind; hasSession: boolean } | null;

function kindFromPath(pathname: string): CheckoutKind {
  if (pathname.endsWith("/failed")) return "failed";
  if (pathname.endsWith("/cancelled")) return "cancelled";
  return "success";
}

export function CheckoutResult() {
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  const kind = kindFromPath(pathname);
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const [card, setCard] = useState<Card>(null);

  useEffect(() => {
    let cancelled = false;
    const set = (next: Card) => {
      if (!cancelled) setCard(next);
    };

    const settle = async () => {
      const params = new URLSearchParams(window.location.search);
      const tranId = params.get("tran_id") ?? "";
      const valId = params.get("val_id") ?? "";
      const status = params.get("status") ?? "";
      const userId = await getSessionUserId();
      if (cancelled) return;

      if (!tranId || !valId) {
        set({ ok: false, kind, hasSession: Boolean(userId) });
        return;
      }

      const { paid, orderId, merchandisePaid } = await completePayment(tranId, valId, status);
      if (cancelled) return;

      if (paid && kind === "success" && userId) {
        await clearCart(userId);
        sessionStorage.setItem(
          RETAILER_NOTICE_KEY,
          merchandisePaid
            ? "Payment received. Your order is with the suppliers."
            : "Delivery payment received. Pay for products in cash when your order arrives.",
        );
        window.location.assign(paymentSuccessPath({ orderId, merchandisePaid }));
        return;
      }

      set({ ok: kind === "success" && paid, kind, hasSession: Boolean(userId) });
    };

    void settle();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const headline =
    kind === "success"
      ? "Confirming your payment."
      : kind === "failed"
        ? "Payment failed."
        : "Payment cancelled.";

  const body = (
    <>
      <PageHeader
        eyebrow="Payment result"
        title={headline}
        copy="We are checking the payment status with SSLCommerz."
      />
      <ResultCard card={card} />
    </>
  );

  if (state.status === "retailer") {
    return (
      <WorkspaceShell
        navigationLabel="Retailer navigation"
        items={[
          { to: "/retailer", icon: House, label: "Overview", active: true },
          { to: "/retailer/catalog", icon: ShoppingBag, label: "Place order" },
          { to: "/retailer/cart", icon: ShoppingCart, label: "Cart" },
          { to: "/retailer/orders", icon: Package, label: "My orders" },
          { to: "/retailer/complaints", icon: MessageSquare, label: "Help Center" },
        ]}
        userName={state.profile.name || state.profile.email}
        userEmail={state.profile.email}
        onLogout={() => void store.signOut()}
      >
        {body}
      </WorkspaceShell>
    );
  }

  return (
    <main className="min-h-svh bg-muted/30 p-4 sm:p-8">
      <div className="mx-auto flex min-h-[calc(100svh-2rem)] max-w-2xl flex-col gap-8 sm:min-h-[calc(100svh-4rem)]">
        <Brand />
        <div className="flex flex-1 items-center justify-center">
          <ResultCard card={card} />
        </div>
      </div>
    </main>
  );
}

function ResultCard({ card }: { card: Card }): ReactNode {
  if (!card) {
    return (
      <Empty role="status" aria-live="polite">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Skeleton className="size-6 rounded-full" />
          </EmptyMedia>
          <EmptyTitle>Checking the payment…</EmptyTitle>
          <EmptyDescription>This usually takes a few seconds.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const { ok, kind, hasSession } = card;
  const ResultIcon: LucideIcon = ok ? Check : kind === "failed" ? Minus : Clock;
  const title = ok
    ? "Payment received"
    : kind === "failed"
      ? "Payment failed"
      : "Payment cancelled";
  const copy = ok
    ? "Your order is with the suppliers."
    : "No charge was made. You can try again from your cart.";
  const href = ok ? (hasSession ? "/retailer/orders" : "/") : "/retailer/cart";
  const label = ok ? (hasSession ? "View orders" : "Sign in") : "Back to cart";

  return (
    <Empty role="status" aria-live="polite">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ResultIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{copy}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <a href={href}>{label}</a>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
