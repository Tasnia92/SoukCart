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
    if (body.action === "complete") {
      return await complete(body);
    }
    if (body.action === "query") {
      return await queryByTranId(body);
    }
    if (body.action === "initiate") {
      const caller = await authorize(request);
      if (caller instanceof Response) {
        return caller;
      }
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

async function initiate(userId: string, body: Record<string, unknown>): Promise<Response> {
  const { data: cartRows, error: cartError } = await admin
    .from("cart_items")
    .select("product_id, quantity, products(name, price)")
    .eq("user_id", userId);
  if (cartError) {
    throw cartError;
  }

  const lines: CartLine[] = [];
  for (const row of cartRows ?? []) {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    if (product && Number(row.quantity) > 0) {
      lines.push({
        product_id: row.product_id,
        quantity: Number(row.quantity),
        product_name: String(product.name),
        price: Number(product.price),
      });
    }
  }
  if (!lines.length) {
    return json({ error: "Your cart is empty." }, 400);
  }

  const total = round2(lines.reduce((sum, line) => sum + line.price * line.quantity, 0));
  if (total < 10) {
    return json({ error: "The order total must be at least 10.00 BDT." }, 400);
  }

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("name, email")
    .eq("id", userId)
    .single();
  if (profileError || !profile) {
    return json({ error: "Your profile could not be loaded." }, 400);
  }

  const checkout = isRecord(body.checkout) ? body.checkout : {};
  const phone = readText(checkout.phone).trim();
  const address = readText(checkout.address).trim();
  const city = readText(checkout.city).trim();
  const postcode = readText(checkout.postcode).trim();
  const notes = readText(checkout.notes).trim() || null;
  if (!phone || !address || !city || !postcode) {
    return json({ error: "Enter your phone number, delivery address, city, and postcode." }, 400);
  }

  const paymentMethod = readText(body.paymentMethod).trim() === "cod" ? "cod" : "online";

  const { data: orderRow, error: orderError } = await admin
    .from("orders")
    .insert({ retailer_id: userId, status: "pending", payment_status: "unpaid", notes })
    .select("id")
    .single();
  if (orderError || !orderRow) {
    throw orderError ?? new Error("The order could not be created.");
  }

  const { error: itemsError } = await admin.from("order_items").insert(
    lines.map((line) => ({
      order_id: orderRow.id,
      product_id: line.product_id,
      quantity: line.quantity,
      unit_price: line.price,
    })),
  );
  if (itemsError) {
    throw itemsError;
  }

  if (paymentMethod === "cod") {
    await admin.from("orders").update({ payment_method: "cod" }).eq("id", orderRow.id);
    return json({ orderId: orderRow.id, paymentStatus: "unpaid", method: "cod" });
  }

  const baseUrl = readText(body.baseUrl).trim().replace(/\/+$/, "") || "";
  if (!baseUrl || !baseUrl.startsWith("http")) {
    return json({ error: "A valid callback base URL is required." }, 400);
  }
  const ipnUrl = readText(body.ipnUrl).trim();

  const tranId = `SOUK-${orderRow.id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  await admin.from("orders").update({ tran_id: tranId }).eq("id", orderRow.id);

  // Browser-visible callbacks must land on a server that can read SSLCommerz's
  // POST fields and redirect; the SPA itself cannot receive form POSTs.
  const returnEndpoint = supabaseUrl
    ? `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/sslcommerz-return`
    : "";
  const appParam = encodeURIComponent(baseUrl);
  const params = new URLSearchParams({
    store_id: storeId,
    store_passwd: storePasswd,
    total_amount: total.toFixed(2),
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
    num_of_item: String(lines.reduce((sum, line) => sum + line.quantity, 0)),
    product_name: lines
      .map((line) => line.product_name)
      .join(", ")
      .slice(0, 255),
    product_category: "general",
    product_profile: "general",
  });
  if (ipnUrl) {
    params.set("ipn_url", ipnUrl);
  }

  const response = await fetch(`${apiBase}/gwprocess/v4/api.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data: unknown = await response.json();

  if (!isRecord(data) || data.status !== "SUCCESS") {
    const reason = isRecord(data) && typeof data.failedreason === "string" ? data.failedreason : "";
    await admin.from("orders").update({ payment_status: "failed" }).eq("id", orderRow.id);
    return json({ error: reason || "The payment could not be started. Please try again." }, 502);
  }

  const gatewayUrl = typeof data.GatewayPageURL === "string" ? data.GatewayPageURL : "";
  if (!gatewayUrl) {
    await admin.from("orders").update({ payment_status: "failed" }).eq("id", orderRow.id);
    return json({ error: "The payment could not be started. Please try again." }, 502);
  }

  if (typeof data.sessionkey === "string") {
    await admin.from("orders").update({ sessionkey: data.sessionkey }).eq("id", orderRow.id);
  }

  return json({ url: gatewayUrl, orderId: orderRow.id, tranId });
}

async function complete(body: Record<string, unknown>): Promise<Response> {
  const tranId = readText(body.tranId).trim();
  const valId = readText(body.valId).trim();
  const status = readText(body.status).trim().toUpperCase();
  if (!tranId || !valId) {
    return json({ error: "Transaction details are missing." }, 400);
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, tran_id, payment_status")
    .eq("tran_id", tranId)
    .maybeSingle();
  if (orderError) {
    throw orderError;
  }
  if (!order) {
    return json({ error: "The order could not be found." }, 404);
  }

  const validation = await validateTransaction(valId);
  const paid =
    (validation.status === "VALID" || validation.status === "VALIDATED") &&
    validation.amount === (await orderTotal(order.id));

  await admin
    .from("orders")
    .update({
      payment_status: paid ? "paid" : status === "CANCELLED" ? "cancelled" : "failed",
      val_id: valId,
      bank_tran_id: paid ? (validation.bank_tran_id ?? null) : null,
      paid_at: paid ? new Date().toISOString() : null,
    })
    .eq("id", order.id);

  return json({ orderId: order.id, paymentStatus: paid ? "paid" : "failed" });
}

type ValidationResult = {
  status: string;
  amount: number | null;
  bank_tran_id: string | null;
};

async function queryByTranId(body: Record<string, unknown>): Promise<Response> {
  const tranId = readText(body.tranId).trim();
  if (!tranId) {
    return json({ error: "Transaction details are missing." }, 400);
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id")
    .eq("tran_id", tranId)
    .maybeSingle();
  if (orderError) {
    throw orderError;
  }
  if (!order) {
    return json({ error: "The order could not be found." }, 404);
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
    return json({ paymentStatus: "unpaid" });
  }

  const expected = await orderTotal(order.id);
  let paidElement: { val_id: string; bank_tran_id: string | null } | undefined;
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
      paidElement = {
        val_id: typeof element.val_id === "string" ? element.val_id : "",
        bank_tran_id: typeof element.bank_tran_id === "string" ? element.bank_tran_id : null,
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
    outcome = "paid";
    await admin
      .from("orders")
      .update({
        payment_status: "paid",
        val_id: paidElement.val_id,
        bank_tran_id: paidElement.bank_tran_id ?? null,
        paid_at: new Date().toISOString(),
      })
      .eq("id", order.id);
  }

  return json({ orderId: order.id, paymentStatus: outcome });
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
