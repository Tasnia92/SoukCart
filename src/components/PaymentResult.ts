import { supabase } from "../supabase.ts";
import { renderBrand } from "./Brand.ts";
import { renderIcon } from "./Icon.ts";

type Outcome = "success" | "failed" | "cancelled" | "unknown";
type ResultState = "paid" | "failed" | "cancelled" | "pending" | "unknown";

export function renderPaymentResult(root: HTMLDivElement): void {
  sessionStorage.removeItem("soukcart:payment-return");
  const params = new URLSearchParams(window.location.search);
  const status = (params.get("status") ?? "").toUpperCase();
  const tranId = params.get("tran_id") ?? "";
  const valId = params.get("val_id") ?? "";
  const outcome: Outcome =
    status === "VALID"
      ? "success"
      : status === "CANCELLED"
        ? "cancelled"
        : status
          ? "failed"
          : "unknown";

  renderShell(root);
  renderOutcome(root, "pending");

  if (tranId && valId) {
    void settle(root, outcome, tranId, valId, status);
  } else if (tranId) {
    void pollStatus(root, outcome, tranId);
  } else {
    void reconcileLatest(root);
  }
}

async function reconcileLatest(root: HTMLDivElement): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) {
    renderOutcome(root, "unknown");
    return;
  }

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: order } = await supabase
    .from("orders")
    .select("id, tran_id, payment_status")
    .eq("retailer_id", session.session.user.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!order?.tran_id) {
    renderOutcome(root, "pending", "", true);
    return;
  }
  if (order.payment_status === "paid") {
    if (await gotoInvoice(order.id)) {
      return;
    }
    renderOutcome(root, "paid", order.id, true);
    return;
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data } = await supabase.functions.invoke("sslcommerz-checkout", {
      body: { action: "query", tranId: order.tran_id },
    });
    const payload = isRecord(data) ? data : null;
    const paymentStatus = typeof payload?.paymentStatus === "string" ? payload.paymentStatus : "";
    const orderId = typeof payload?.orderId === "string" ? payload.orderId : order.id;
    if (paymentStatus === "paid") {
      if (await gotoInvoice(orderId)) {
        return;
      }
      renderOutcome(root, "paid", orderId, true);
      return;
    }
    if (paymentStatus === "failed" || paymentStatus === "cancelled") {
      renderOutcome(root, paymentStatus === "cancelled" ? "cancelled" : "failed", orderId, true);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
  }

  renderOutcome(root, "pending", order.id, true);
}

async function settle(
  root: HTMLDivElement,
  outcome: Outcome,
  tranId: string,
  valId: string,
  status: string,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke("sslcommerz-checkout", {
    body: { action: "complete", tranId, valId, status },
  });
  const payload = isRecord(data) ? data : null;
  const paid = !error && payload?.paymentStatus === "paid";
  const orderId = typeof payload?.orderId === "string" ? payload.orderId : "";

  if (paid) {
    if (await gotoInvoice(orderId)) {
      return;
    }
  }

  const { data: session } = await supabase.auth.getSession();
  renderOutcome(
    root,
    paid ? "paid" : outcome === "cancelled" ? "cancelled" : "failed",
    orderId,
    Boolean(session.session),
  );
}

async function pollStatus(root: HTMLDivElement, outcome: Outcome, tranId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const hasSession = Boolean(session.session);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data } = await supabase.functions.invoke("sslcommerz-checkout", {
      body: { action: "query", tranId },
    });
    const payload = isRecord(data) ? data : null;
    const paymentStatus = typeof payload?.paymentStatus === "string" ? payload.paymentStatus : "";
    const orderId = typeof payload?.orderId === "string" ? payload.orderId : "";
    if (paymentStatus === "paid") {
      if (await gotoInvoice(orderId)) {
        return;
      }
      renderOutcome(root, "paid", orderId, hasSession);
      return;
    }
    if (paymentStatus === "failed" || paymentStatus === "cancelled") {
      renderOutcome(root, outcome === "cancelled" ? "cancelled" : "failed", orderId, hasSession);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
  }

  renderOutcome(root, "pending", "", hasSession);
}

async function gotoInvoice(orderId: string): Promise<boolean> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) {
    return false;
  }
  await supabase.from("cart_items").delete().eq("user_id", session.session.user.id);
  if (!orderId) {
    return false;
  }
  window.location.assign(`/retailer/orders/${orderId}/invoice`);
  return true;
}

function renderShell(root: HTMLDivElement): void {
  root.innerHTML = `
    <div class="plain-screen">
      ${renderBrand()}
      <div class="rt-empty-card" data-payment-result>
        <span class="rt-empty-icon">${renderIcon("clock")}</span>
        <strong>Checking the payment…</strong>
        <span>This usually takes a few seconds.</span>
      </div>
    </div>`;
}

function renderOutcome(
  root: HTMLDivElement,
  state: ResultState,
  orderId = "",
  hasSession = false,
): void {
  const card = root.querySelector<HTMLElement>("[data-payment-result]");
  if (!card) {
    return;
  }

  const icon =
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

  let action = "";
  if (state === "paid") {
    if (orderId && hasSession) {
      action = `<a class="button button-primary" href="/retailer/orders/${orderId}/invoice"><span>View invoice</span></a>`;
    } else if (hasSession) {
      action = `<a class="button button-primary" href="/retailer/orders"><span>View orders</span></a>`;
    } else {
      action = `<a class="button button-primary" href="/"><span>Sign in</span></a>`;
    }
  } else if (state === "pending") {
    action = hasSession
      ? `<a class="button button-primary" href="/retailer/orders"><span>View orders</span></a>`
      : `<a class="button button-primary" href="/"><span>Sign in</span></a>`;
  } else {
    action = hasSession
      ? `<a class="button button-primary" href="/retailer/orders"><span>View orders</span></a>`
      : `<a class="button button-primary" href="/"><span>Sign in</span></a>`;
  }

  card.innerHTML = `
    <span class="rt-empty-icon${state === "paid" ? " is-success" : ""}">${renderIcon(icon)}</span>
    <strong>${title}</strong>
    <span>${copy}</span>
    ${action}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
