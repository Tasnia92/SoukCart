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
  if (request.method === "OPTIONS") {
    return new Response("ok");
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    if (!storeId || !storePasswd) {
      console.error("SSLCommerz store credentials are not configured.");
      return new Response("Store credentials are not configured.", { status: 500 });
    }

    const form = await request.formData();
    const tranId = readText(form.get("tran_id"));
    const valId = readText(form.get("val_id"));
    const status = readText(form.get("status")).toUpperCase();
    if (!tranId) {
      console.error("IPN received without tran_id");
      return new Response("Missing transaction details.", { status: 400 });
    }

    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("id, payment_status")
      .eq("tran_id", tranId)
      .maybeSingle();
    if (orderError) {
      throw orderError;
    }
    if (!order) {
      console.error(`IPN received for unknown tran_id ${tranId}`);
      return new Response("Order not found.", { status: 404 });
    }

    if (order.payment_status === "paid") {
      return new Response("OK");
    }

    let paid = false;
    if (status === "VALID" && valId) {
      const validation = await validateTransaction(valId);
      paid =
        (validation.status === "VALID" || validation.status === "VALIDATED") &&
        validation.amount === (await orderTotal(order.id));
    }

    if (paid) {
      const { error: paymentError } = await admin
        .from("orders")
        .update({
          payment_status: "paid",
          val_id: valId,
          paid_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .neq("payment_status", "paid");
      if (paymentError) {
        console.error("Paid order could not reserve stock", paymentError);
        return new Response("Payment requires administrator review.", { status: 409 });
      }
    } else if (isTerminalFailure(status)) {
      // A failed or cancelled gateway result must release the reserved stock
      // without waiting for the buyer to return to the app. Downgrading only
      // an "unpaid" order fires handle_order_inventory_reservation, which
      // returns the units to sellable stock. The unpaid guard makes this a
      // no-op if the order was already paid or already released (e.g. by the
      // expire_stale_unpaid_orders job), so stock is never released twice.
      const nextStatus = status === "CANCELLED" ? "cancelled" : "failed";
      const { error: releaseError } = await admin
        .from("orders")
        .update({ payment_status: nextStatus, val_id: valId || null })
        .eq("id", order.id)
        .eq("payment_status", "unpaid");
      if (releaseError) {
        console.error("Failed online order could not release stock", releaseError);
        return new Response("IPN handling failed.", { status: 500 });
      }
    }

    return new Response("OK");
  } catch (error) {
    console.error("SSLCommerz IPN failed", error);
    return new Response("IPN handling failed.", { status: 500 });
  }
});

async function validateTransaction(valId: string): Promise<{
  status: string;
  amount: number | null;
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
    throw new Error("The transaction validation returned an invalid response.");
  }
  return {
    status: typeof data.status === "string" ? data.status : "",
    amount:
      typeof data.amount === "string" || typeof data.amount === "number"
        ? Number(data.amount)
        : null,
  };
}

async function orderTotal(orderId: string): Promise<number> {
  const { data: items, error } = await admin
    .from("order_items")
    .select("quantity, unit_price")
    .eq("order_id", orderId);
  if (error) {
    throw error;
  }
  return round2(
    (items ?? []).reduce(
      (sum: number, item: { quantity: number; unit_price: number }) =>
        sum + Number(item.unit_price) * Number(item.quantity),
      0,
    ),
  );
}

function readText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

// SSLCommerz reports a terminal, non-recoverable outcome with one of these
// statuses. Anything else (e.g. a VALID result we could not validate) is left
// untouched so the return handler or the scheduled expiry job can resolve it.
function isTerminalFailure(status: string): boolean {
  return (
    status === "FAILED" ||
    status === "CANCELLED" ||
    status === "EXPIRED" ||
    status === "UNATTEMPTED"
  );
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
