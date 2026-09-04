// @ts-expect-error Deno resolves npm imports in the Edge runtime.
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const validatorBase = Deno.env.get("SSLCOMMERZ_VALIDATOR_BASE") ?? "https://sandbox.sslcommerz.com";
const storeId = Deno.env.get("SSLCOMMERZ_STORE_ID") ?? "";
const storePasswd = Deno.env.get("SSLCOMMERZ_STORE_PASSWD") ?? "";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = getServiceKey();
const admin = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

Deno.serve(async (request) => {
  let appBase = "";
  try {
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const fields = await readFields(request);
    appBase = sanitizeAppBase(fields.get("app"));
    const outcomeHint = fields.get("outcome") ?? "";
    const tranId = fields.get("tran_id") ?? "";
    const valId = fields.get("val_id") ?? "";
    const status = (fields.get("status") ?? "").toUpperCase();

    if (!storeId || !storePasswd) {
      console.error("SSLCommerz store credentials are not configured.");
      return respond(appBase, "failed", "", "Store credentials are not configured.");
    }
    if (!tranId) {
      return respond(appBase, "unknown", "", "No transaction reference was received.");
    }

    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("id, retailer_id, payment_method, payment_status, delivery_payment_status")
      .eq("tran_id", tranId)
      .maybeSingle();
    if (orderError) {
      throw orderError;
    }
    if (!order) {
      return respond(appBase, "unknown", "", `Unknown transaction ${tranId}.`);
    }

    if (isGatewayCaptured(order)) {
      await clearCart(order.retailer_id);
      return respond(appBase, "success", order.id);
    }
    if (!isGatewayOpen(order)) {
      return respond(
        appBase,
        "failed",
        order.id,
        `Capture refused for ${tranId}: payment_status=${order.payment_status}, delivery_payment_status=${order.delivery_payment_status}`,
      );
    }

    const result = await settle({
      orderId: order.id,
      retailerId: order.retailer_id,
      tranId,
      valId,
      status,
      hint: outcomeHint,
    });

    if (result.paid) {
      const { error: paymentError } = await admin.rpc("capture_gateway_payment", {
        p_order_id: order.id,
        p_amount: result.amount,
        p_val_id: result.valId ?? (valId || null),
        p_bank_tran_id: result.bankTranId ?? null,
      });
      if (paymentError) {
        console.error("Paid order could not be captured", paymentError);
        return respond(
          appBase,
          "failed",
          order.id,
          "Payment was captured, but inventory requires administrator review.",
        );
      }
      await clearCart(retailerSafe(result.retailerId, order.retailer_id));
    } else if (result.outcome !== "unpaid" && result.hardFail) {
      const { error: paymentError } = await admin.rpc("fail_gateway_payment", {
        p_order_id: order.id,
        p_status: result.outcome,
        p_val_id: valId || null,
      });
      if (paymentError) {
        throw paymentError;
      }
    }

    const redirect =
      result.outcome === "cancelled"
        ? "cancelled"
        : result.paid
          ? "success"
          : result.outcome === "unpaid" && !result.hardFail
            ? ""
            : "failed";
    return respond(appBase, redirect, order.id);
  } catch (error) {
    console.error("SSLCommerz return handling failed", error);
    return respond(appBase, "failed", "", "Return handling failed.");
  }
});

type SettleResult = {
  paid: boolean;
  outcome: "unpaid" | "paid" | "failed" | "cancelled";
  hardFail: boolean;
  amount: number;
  valId?: string | null;
  bankTranId?: string | null;
  retailerId?: string;
};

type GatewayOrder = {
  payment_method: string | null;
  payment_status: string | null;
  delivery_payment_status: string | null;
};

function isGatewayCaptured(order: GatewayOrder): boolean {
  if (order.payment_method === "cod") {
    return order.delivery_payment_status === "paid";
  }
  return order.payment_status === "paid" && order.delivery_payment_status === "paid";
}

function isGatewayOpen(order: GatewayOrder): boolean {
  if (order.payment_method === "cod") {
    return (
      order.delivery_payment_status === "unpaid" &&
      order.payment_status !== "failed" &&
      order.payment_status !== "cancelled"
    );
  }
  return order.payment_status === "unpaid";
}

async function settle(input: {
  orderId: string;
  retailerId: string;
  tranId: string;
  valId: string;
  status: string;
  hint: string;
}): Promise<SettleResult> {
  const expected = await orderGatewayAmount(input.orderId);

  // Success-style callbacks carry a val_id: validate it directly.
  const looksSuccessful =
    input.status === "" || input.status.startsWith("VALID") || input.hint === "success";
  if (input.valId && looksSuccessful) {
    const validation = await validateTransaction(input.valId);
    const paid =
      (validation.status === "VALID" || validation.status === "VALIDATED") &&
      validation.amount === expected;
    if (paid) {
      return {
        paid: true,
        outcome: "paid",
        hardFail: false,
        amount: expected,
        valId: input.valId,
        bankTranId: validation.bank_tran_id,
        retailerId: input.retailerId,
      };
    }
    if (validation.status) {
      return { paid: false, outcome: "failed", hardFail: true, amount: expected };
    }
  }

  // No usable val_id: ask the gateway what happened to this transaction.
  const queried = await queryByTranId(input.tranId, expected);
  if (queried.paymentStatus === "paid") {
    return {
      paid: true,
      outcome: "paid",
      hardFail: false,
      amount: expected,
      valId: queried.valId ?? input.valId,
      bankTranId: queried.bankTranId,
      retailerId: input.retailerId,
    };
  }

  const known = queried.known || Boolean(input.status);
  const status =
    queried.paymentStatus !== "unpaid"
      ? queried.paymentStatus
      : input.hint === "cancelled" ||
          input.status.includes("CANCELLED") ||
          input.status.includes("UNATTEMPTED")
        ? "cancelled"
        : input.status.includes("FAILED") ||
            input.status.includes("EXPIRED") ||
            input.hint === "failed"
          ? "failed"
          : "unpaid";
  return {
    paid: false,
    outcome: status,
    hardFail: known,
    amount: expected,
  };
}

async function queryByTranId(
  tranId: string,
  expected: number,
): Promise<{
  paymentStatus: "unpaid" | "paid" | "failed" | "cancelled";
  valId: string | null;
  bankTranId: string | null;
  known: boolean;
}> {
  const params = new URLSearchParams({
    tran_id: tranId,
    store_id: storeId,
    store_passwd: storePasswd,
    format: "json",
  });
  const response = await fetch(
    `${validatorBase}/validator/api/merchantTransIDvalidationAPI.php?${params.toString()}`,
  );
  const data: unknown = await response.json();
  if (!isRecord(data) || data.APIConnect !== "DONE" || !Array.isArray(data.element)) {
    return { paymentStatus: "unpaid", valId: null, bankTranId: null, known: false };
  }

  let valId: string | null = null;
  let bankTranId: string | null = null;
  let outcome: "unpaid" | "paid" | "failed" | "cancelled" = "unpaid";
  for (const element of data.element) {
    if (!isRecord(element)) {
      continue;
    }
    const elementStatus = typeof element.status === "string" ? element.status.toUpperCase() : "";
    const amount =
      typeof element.amount === "string" || typeof element.amount === "number"
        ? Number(element.amount)
        : null;
    if ((elementStatus === "VALID" || elementStatus === "VALIDATED") && amount === expected) {
      outcome = "paid";
      valId = typeof element.val_id === "string" ? element.val_id : null;
      bankTranId = typeof element.bank_tran_id === "string" ? element.bank_tran_id : null;
      break;
    }
    if (elementStatus === "CANCELLED") {
      outcome = "cancelled";
    } else if (elementStatus && outcome === "unpaid") {
      outcome = "failed";
    }
  }
  return { paymentStatus: outcome, valId, bankTranId, known: true };
}

async function validateTransaction(valId: string): Promise<{
  status: string;
  amount: number | null;
  bank_tran_id: string | null;
}> {
  const params = new URLSearchParams({
    val_id: valId,
    store_id: storeId,
    store_passwd: storePasswd,
    format: "json",
  });
  const response = await fetch(
    `${validatorBase}/validator/api/validationserverAPI.php?${params.toString()}`,
  );
  const data: unknown = await response.json();
  if (!isRecord(data)) {
    return { status: "", amount: null, bank_tran_id: null };
  }
  return {
    status: typeof data.status === "string" ? data.status.toUpperCase() : "",
    amount:
      typeof data.amount === "string" || typeof data.amount === "number"
        ? Number(data.amount)
        : null,
    bank_tran_id: typeof data.bank_tran_id === "string" ? data.bank_tran_id : null,
  };
}

async function orderGatewayAmount(orderId: string): Promise<number> {
  const { data, error } = await admin.rpc("order_gateway_amount", {
    p_order_id: orderId,
  });
  if (error) {
    throw error;
  }
  return round2(Number(data ?? 0));
}

function retailerSafe(primary: string | undefined, fallback: string): string {
  return primary ?? fallback;
}

async function clearCart(userId: string): Promise<void> {
  if (!userId) {
    return;
  }
  const { error } = await admin.from("cart_items").delete().eq("user_id", userId);
  if (error) {
    console.error("Cart could not be cleared after payment.", error.message);
  }
}

async function readFields(request: Request): Promise<Map<string, string>> {
  const fields = new Map<string, string>();
  for (const [key, value] of new URL(request.url).searchParams) {
    fields.set(key.toLowerCase(), value);
  }
  if (request.method === "POST") {
    try {
      const form = await request.formData();
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") {
          fields.set(key.toLowerCase(), value);
        }
      }
    } catch {
      // No parsable form body; query params may still carry everything needed.
    }
  }
  return fields;
}

function sanitizeAppBase(value: string | undefined): string {
  const candidate = (value ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(candidate) ? candidate : "";
}

function respond(appBase: string, kind: string, orderId: string, logNote = ""): Response {
  if (logNote) {
    console.error(`SSLCommerz return: ${logNote}`);
  }
  const target = redirectTarget(appBase, kind, orderId);
  if (target) {
    return new Response(null, { status: 303, headers: { Location: target } });
  }
  const title = kind === "success" ? "Payment received." : "Payment processed.";
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Payment</title></head>` +
      `<body>${title} You can close this window and return to Bazarsync.</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function redirectTarget(appBase: string, kind: string, orderId: string): string {
  if (!appBase) {
    return "";
  }
  if (kind === "success" && orderId) {
    return `${appBase}/retailer/orders/${orderId}/invoice`;
  }
  if (kind === "cancelled") {
    return `${appBase}/retailer/checkout/cancelled`;
  }
  if (kind === "failed") {
    return `${appBase}/retailer/checkout/failed`;
  }
  if (kind === "unknown") {
    return `${appBase}/retailer/orders`;
  }
  return `${appBase}/retailer/orders`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getServiceKey(): string {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) {
    return legacyKey;
  }

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed: unknown = JSON.parse(secretKeys);
      if (isRecord(parsed) && typeof parsed.default === "string") {
        return parsed.default;
      }
    } catch {
      // Fall through to the explicit error below.
    }
  }

  throw new Error("No Supabase service key is configured.");
}
