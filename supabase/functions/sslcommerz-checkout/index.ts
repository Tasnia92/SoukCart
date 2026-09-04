// @ts-expect-error Deno resolves npm imports in the Edge runtime.
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const apiBase = Deno.env.get("SSLCOMMERZ_API_BASE") ?? "https://sandbox-gw.sslcommerz.com";
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
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Only POST requests are supported." }, 405);
  }

  try {
    if (!storeId || !storePasswd) {
      return json(
        { error: "SSLCommerz store credentials are not configured on this project." },
        500,
      );
    }

    const body = await readBody(request);
    const caller = await authorize(request);
    if (caller instanceof Response) {
      return caller;
    }
    if (body.action === "complete") {
      return await complete(caller.id, body);
    }
    if (body.action === "query") {
      return await queryByTranId(caller.id, body);
    }
    if (body.action === "initiate") {
      return await initiate(caller.id, body);
    }
    return json({ error: "Choose a valid checkout action." }, 400);
  } catch (error) {
    console.error("SSLCommerz checkout failed", error);
    return json({ error: "The checkout service could not complete that request." }, 500);
  }
});

type CartLine = {
  product_id: string;
  quantity: number;
  product_name: string;
  price: number;
};

type ReservedCheckout = {
  orderId: string;
  total: number;
  merchandiseTotal: number;
  deliveryCharge: number;
  payableNow: number;
  paymentMethod: "online" | "cod";
  lines: CartLine[];
};

type OrderPaymentRow = {
  id: string;
  payment_method: string | null;
  payment_status: string | null;
  delivery_payment_status: string | null;
};

async function initiate(userId: string, body: Record<string, unknown>): Promise<Response> {
  const checkout = isRecord(body.checkout) ? body.checkout : {};
  const phone = readText(checkout.phone).trim();
  const address = readText(checkout.address).trim();
  const city = readText(checkout.city).trim();
  const postcode = readText(checkout.postcode).trim();
  const notes = readText(checkout.notes).trim();
  if (!phone || !address || !city || !postcode) {
    return json({ error: "Enter your phone number, delivery address, city, and postcode." }, 400);
  }

  const paymentMethod = readText(body.paymentMethod).trim() === "cod" ? "cod" : "online";
  const baseUrl = readText(body.baseUrl).trim().replace(/\/+$/, "");
  // Online and COD both open SSLCommerz (COD prepays delivery only).
  if (!baseUrl || !baseUrl.startsWith("http")) {
    return json({ error: "A valid callback base URL is required." }, 400);
  }

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("name, email")
    .eq("id", userId)
    .single();
  if (profileError || !profile) {
    return json({ error: "Your profile could not be loaded." }, 400);
  }

  const { data: reservedData, error: reserveError } = await admin.rpc("create_order_from_cart", {
    p_retailer_id: userId,
    p_notes: notes,
    p_payment_method: paymentMethod,
    p_phone: phone,
    p_address: address,
    p_city: city,
    p_postcode: postcode,
  });
  if (reserveError) {
    return json({ error: reserveError.message }, 409);
  }

  const reserved = parseReservedCheckout(reservedData);
  if (!reserved) {
    throw new Error("The reserved order returned invalid details.");
  }

  const ipnUrl = readText(body.ipnUrl).trim();
  const tranId = `SOUK-${reserved.orderId.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const { error: referenceError } = await admin
    .from("orders")
    .update({ tran_id: tranId })
    .eq("id", reserved.orderId);
  if (referenceError) {
    await failReservedOrder(reserved.orderId);
    throw referenceError;
  }

  // Browser-visible callbacks must land on a server that can read SSLCommerz's
  // POST fields and redirect; the SPA itself cannot receive form POSTs.
  const returnEndpoint = supabaseUrl
    ? `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/sslcommerz-return`
    : "";
  const appParam = encodeURIComponent(baseUrl);
  const gatewayAmount = Number(reserved.payableNow);
  const params = new URLSearchParams({
    store_id: storeId,
    store_passwd: storePasswd,
    total_amount: gatewayAmount.toFixed(2),
    currency: "BDT",
    tran_id: tranId,
    success_url: returnEndpoint ? `${returnEndpoint}?app=${appParam}` : `${baseUrl}/`,
    fail_url: returnEndpoint ? `${returnEndpoint}?app=${appParam}&outcome=failed` : `${baseUrl}/`,
    cancel_url: returnEndpoint
      ? `${returnEndpoint}?app=${appParam}&outcome=cancelled`
      : `${baseUrl}/`,
    cus_name: String(profile.name || profile.email),
    cus_email: String(profile.email),
    cus_add1: address,
    cus_city: city,
    cus_postcode: postcode,
    cus_country: "Bangladesh",
    cus_phone: phone,
    shipping_method: "NO",
    num_of_item: String(reserved.lines.reduce((sum, line) => sum + line.quantity, 0)),
    product_name: reserved.lines
      .map((line) => line.product_name)
      .join(", ")
      .slice(0, 255),
    product_category: "general",
    product_profile: "general",
  });
  if (ipnUrl) {
    params.set("ipn_url", ipnUrl);
  }

  try {
    const response = await fetch(`${apiBase}/gwprocess/v4/api.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const data: unknown = await response.json();

    if (!isRecord(data) || data.status !== "SUCCESS") {
      const reason =
        isRecord(data) && typeof data.failedreason === "string" ? data.failedreason : "";
      await failReservedOrder(reserved.orderId);
      return json({ error: reason || "The payment could not be started. Please try again." }, 502);
    }

    const gatewayUrl = typeof data.GatewayPageURL === "string" ? data.GatewayPageURL : "";
    if (!gatewayUrl) {
      await failReservedOrder(reserved.orderId);
      return json({ error: "The payment could not be started. Please try again." }, 502);
    }

    if (typeof data.sessionkey === "string") {
      await admin.from("orders").update({ sessionkey: data.sessionkey }).eq("id", reserved.orderId);
    }

    return json({ url: gatewayUrl, orderId: reserved.orderId, tranId });
  } catch (error) {
    await failReservedOrder(reserved.orderId);
    throw error;
  }
}

function parseReservedCheckout(value: unknown): ReservedCheckout | null {
  if (!isRecord(value)) return null;
  const orderId = readText(value.orderId);
  const merchandiseTotal = Number(
    value.merchandiseTotal !== undefined ? value.merchandiseTotal : value.total,
  );
  const deliveryCharge = Number(value.deliveryCharge ?? 0);
  const paymentMethod = readText(value.paymentMethod).trim() === "cod" ? "cod" : "online";
  const total = Number.isFinite(Number(value.total)) ? Number(value.total) : merchandiseTotal;
  let payableNow = Number(value.payableNow);
  if (!Number.isFinite(payableNow)) {
    payableNow =
      paymentMethod === "cod" ? deliveryCharge : round2(merchandiseTotal + deliveryCharge);
  }

  const rawLines = Array.isArray(value.lines) ? value.lines : [];
  const lines: CartLine[] = [];

  for (const rawLine of rawLines) {
    if (!isRecord(rawLine)) return null;
    const line = {
      product_id: readText(rawLine.product_id),
      quantity: Number(rawLine.quantity),
      product_name: readText(rawLine.product_name),
      price: Number(rawLine.price),
    };
    if (
      !line.product_id ||
      !line.product_name ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      !Number.isFinite(line.price) ||
      line.price <= 0
    ) {
      return null;
    }
    lines.push(line);
  }

  return orderId &&
    Number.isFinite(merchandiseTotal) &&
    merchandiseTotal > 0 &&
    Number.isFinite(total) &&
    total > 0 &&
    Number.isFinite(deliveryCharge) &&
    deliveryCharge >= 0 &&
    Number.isFinite(payableNow) &&
    payableNow > 0 &&
    lines.length
    ? {
        orderId,
        total,
        merchandiseTotal,
        deliveryCharge,
        payableNow,
        paymentMethod,
        lines,
      }
    : null;
}

async function failReservedOrder(orderId: string): Promise<void> {
  const { error } = await admin.rpc("fail_gateway_payment", {
    p_order_id: orderId,
    p_status: "failed",
    p_val_id: null,
  });
  if (error) {
    console.error("Reserved stock could not be released", error);
  }
}

function isAlreadyCaptured(order: OrderPaymentRow): boolean {
  if (order.payment_method === "cod") {
    return order.delivery_payment_status === "paid";
  }
  return order.payment_status === "paid" && order.delivery_payment_status === "paid";
}

function isCheckoutOpen(order: OrderPaymentRow): boolean {
  if (order.payment_method === "cod") {
    return (
      order.delivery_payment_status === "unpaid" &&
      order.payment_status !== "failed" &&
      order.payment_status !== "cancelled"
    );
  }
  return order.payment_status === "unpaid";
}

function settlementResponse(order: OrderPaymentRow, extra: Record<string, unknown> = {}): Response {
  return json({
    orderId: order.id,
    paymentMethod: order.payment_method ?? "online",
    paymentStatus: order.payment_status ?? "unpaid",
    deliveryPaymentStatus: order.delivery_payment_status ?? "unpaid",
    ...extra,
  });
}

async function complete(userId: string, body: Record<string, unknown>): Promise<Response> {
  const tranId = readText(body.tranId).trim();
  const valId = readText(body.valId).trim();
  const status = readText(body.status).trim().toUpperCase();
  if (!tranId || !valId) {
    return json({ error: "Transaction details are missing." }, 400);
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, tran_id, payment_method, payment_status, delivery_payment_status")
    .eq("tran_id", tranId)
    .eq("retailer_id", userId)
    .maybeSingle();
  if (orderError) {
    throw orderError;
  }
  if (!order) {
    return json({ error: "The order could not be found." }, 404);
  }
  if (isAlreadyCaptured(order)) {
    return settlementResponse(order);
  }
  if (!isCheckoutOpen(order)) {
    return json(
      {
        error:
          "This checkout is no longer valid. If money was taken, contact support for a refund.",
      },
      409,
    );
  }

  const validation = await validateTransaction(valId);
  const paid =
    (validation.status === "VALID" || validation.status === "VALIDATED") &&
    validation.amount === (await orderTotal(order.id));

  if (paid) {
    const { data: captured, error: captureError } = await admin.rpc("capture_gateway_payment", {
      p_order_id: order.id,
      p_amount: validation.amount,
      p_val_id: valId,
      p_bank_tran_id: validation.bank_tran_id ?? null,
    });
    if (captureError) {
      return json(
        {
          error:
            captureError.message ||
            "Payment was captured, but stock could not be reserved. Contact an administrator for fulfillment or refund support.",
        },
        409,
      );
    }
    return settlementFromRpc(order.id, captured);
  }

  const nextStatus = status === "CANCELLED" ? "cancelled" : "failed";
  const { data: failed, error: failError } = await admin.rpc("fail_gateway_payment", {
    p_order_id: order.id,
    p_status: nextStatus,
    p_val_id: valId,
  });
  if (failError) {
    throw failError;
  }

  return settlementFromRpc(order.id, failed);
}

type ValidationResult = {
  status: string;
  amount: number | null;
  bank_tran_id: string | null;
};

async function queryByTranId(userId: string, body: Record<string, unknown>): Promise<Response> {
  const tranId = readText(body.tranId).trim();
  if (!tranId) {
    return json({ error: "Transaction details are missing." }, 400);
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, payment_method, payment_status, delivery_payment_status")
    .eq("tran_id", tranId)
    .eq("retailer_id", userId)
    .maybeSingle();
  if (orderError) {
    throw orderError;
  }
  if (!order) {
    return json({ error: "The order could not be found." }, 404);
  }
  if (isAlreadyCaptured(order)) {
    return settlementResponse(order);
  }
  if (!isCheckoutOpen(order)) {
    return json(
      {
        error:
          "This checkout is no longer valid. If money was taken, contact support for a refund.",
      },
      409,
    );
  }

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
    return settlementResponse(order);
  }

  const expected = await orderTotal(order.id);
  let paidElement: { val_id: string; bank_tran_id: string | null; amount: number } | undefined;
  let outcome: "unpaid" | "failed" | "cancelled" = "unpaid";
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
      paidElement = {
        val_id: typeof element.val_id === "string" ? element.val_id : "",
        bank_tran_id: typeof element.bank_tran_id === "string" ? element.bank_tran_id : null,
        amount,
      };
      break;
    }
    if (elementStatus === "CANCELLED") {
      outcome = "cancelled";
    } else if (elementStatus && outcome === "unpaid") {
      outcome = "failed";
    }
  }

  if (paidElement) {
    const { data: captured, error: captureError } = await admin.rpc("capture_gateway_payment", {
      p_order_id: order.id,
      p_amount: paidElement.amount,
      p_val_id: paidElement.val_id,
      p_bank_tran_id: paidElement.bank_tran_id ?? null,
    });
    if (captureError) {
      return json(
        {
          error:
            captureError.message ||
            "Payment was captured, but stock could not be reserved. Contact an administrator for fulfillment or refund support.",
        },
        409,
      );
    }
    return settlementFromRpc(order.id, captured);
  }

  if (outcome === "failed" || outcome === "cancelled") {
    const { data: failed, error: failError } = await admin.rpc("fail_gateway_payment", {
      p_order_id: order.id,
      p_status: outcome,
      p_val_id: null,
    });
    if (failError) {
      throw failError;
    }
    return settlementFromRpc(order.id, failed);
  }

  return settlementResponse(order);
}

function settlementFromRpc(orderId: string, value: unknown): Response {
  if (!isRecord(value)) {
    return json({ orderId, paymentStatus: "unpaid", deliveryPaymentStatus: "unpaid" });
  }
  return json({
    orderId: typeof value.orderId === "string" ? value.orderId : orderId,
    paymentStatus: typeof value.paymentStatus === "string" ? value.paymentStatus : "unpaid",
    deliveryPaymentStatus:
      typeof value.deliveryPaymentStatus === "string" ? value.deliveryPaymentStatus : "unpaid",
    alreadyCaptured: value.alreadyCaptured === true,
  });
}

async function validateTransaction(valId: string): Promise<ValidationResult> {
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
    bank_tran_id: typeof data.bank_tran_id === "string" ? data.bank_tran_id : null,
  };
}

async function orderTotal(orderId: string): Promise<number> {
  const { data, error } = await admin.rpc("order_gateway_amount", {
    p_order_id: orderId,
  });
  if (error) {
    throw error;
  }
  const amount = Number(data);
  if (!Number.isFinite(amount)) {
    throw new Error("The gateway amount could not be determined.");
  }
  return round2(amount);
}

async function authorize(request: Request): Promise<{ id: string } | Response> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Authentication is required." }, 401);
  }

  const token = authorization.slice(7).trim();
  if (!token) {
    return json({ error: "Authentication is required." }, 401);
  }

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return json({ error: "Your session is no longer valid." }, 401);
  }

  return { id: data.user.id };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
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

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
