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

// Sandbox-only defaults for the PhD demo. Do not point this at live Pathao.
const pathaoBase = Deno.env.get("PATHAO_BASE_URL") ?? "https://courier-api-sandbox.pathao.com";
const clientId = Deno.env.get("PATHAO_CLIENT_ID") ?? "7N1aMJQbWm";
const clientSecret =
  Deno.env.get("PATHAO_CLIENT_SECRET") ?? "wRcaibZkUdSNz2EI9ZyuXLlNrnAv0TdPUPXMnD39";
const username = Deno.env.get("PATHAO_USERNAME") ?? "test@pathao.com";
const password = Deno.env.get("PATHAO_PASSWORD") ?? "lovePathao";
const configuredStoreId = Deno.env.get("PATHAO_STORE_ID") ?? "150828";

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
    const body = await readBody(request);
    const action = readText(body.action).trim();
    const caller = await authorize(request);
    if (caller instanceof Response) {
      return caller;
    }

    if (action === "ship") {
      return await shipWithPathao(caller.id, body);
    }
    if (action === "sync") {
      return await syncShipment(caller.id, body);
    }
    if (action === "stores") {
      return await listStores(caller.id);
    }

    return json({ error: "Choose a valid Pathao action." }, 400);
  } catch (error) {
    console.error("Pathao courier failed", error);
    const message =
      error instanceof Error ? error.message : "The Pathao courier request could not be completed.";
    // Business/API failures (dues, validation) are client-visible 400s.
    const status = /due|invalid|required|not found|wait for|cannot/i.test(message) ? 400 : 500;
    return json({ error: message }, status);
  }
});

type OrderRow = {
  id: string;
  status: string;
  cancel_requested: boolean | null;
  payment_method: string | null;
  payment_status: string | null;
  delivery_payment_status: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  notes: string | null;
  retailer_id: string;
};

type OrderItemRow = {
  quantity: number;
  unit_price: number | string;
  product_name: string | null;
  seller_id: string | null;
};

async function shipWithPathao(sellerId: string, body: Record<string, unknown>): Promise<Response> {
  const orderId = readText(body.orderId).trim();
  if (!orderId) {
    return json({ error: "Choose an order to ship." }, 400);
  }

  const weightRaw = Number(body.itemWeight ?? 0.5);
  const itemWeight = Number.isFinite(weightRaw) ? Math.min(Math.max(weightRaw, 0.5), 10) : 0.5;
  const notes = readText(body.notes).trim();

  const seller = await loadSeller(sellerId);
  if (seller instanceof Response) return seller;

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select(
      "id, status, cancel_requested, payment_method, payment_status, delivery_payment_status, delivery_phone, delivery_address, delivery_city, delivery_postcode, notes, retailer_id",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) return json({ error: "Order not found." }, 404);

  const placed = order as OrderRow;
  if (placed.cancel_requested) {
    return json({ error: "This order has a cancellation request. Wait for the admin team." }, 409);
  }
  if (placed.status !== "confirmed") {
    return json({ error: "Only confirmed orders can be shipped with Pathao." }, 409);
  }
  if (placed.delivery_payment_status !== "paid") {
    return json(
      { error: "Wait for the retailer to pay the delivery charge before shipping." },
      409,
    );
  }
  if (placed.payment_method !== "cod" && placed.payment_status !== "paid") {
    return json({ error: "Wait for payment before shipping this order." }, 409);
  }

  const { data: items, error: itemsError } = await admin
    .from("order_items")
    .select("quantity, unit_price, product_name, seller_id")
    .eq("order_id", orderId);
  if (itemsError) throw itemsError;

  const lines = (items ?? []) as OrderItemRow[];
  if (!lines.length) {
    return json({ error: "This order has no items to ship." }, 400);
  }
  if (lines.some((item) => item.seller_id !== sellerId)) {
    return json(
      { error: "A supplier cannot fulfill a multi-supplier order. Contact the admin team." },
      403,
    );
  }
  if (!lines.some((item) => item.seller_id === sellerId)) {
    return json({ error: "This order is not assigned to your supplier account." }, 403);
  }

  const { data: existingShipment, error: shipmentError } = await admin
    .from("order_shipments")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (shipmentError) throw shipmentError;
  if (existingShipment) {
    return json({ error: "A shipment already exists for this order." }, 409);
  }

  const { data: retailer, error: retailerError } = await admin
    .from("users")
    .select("name, email")
    .eq("id", placed.retailer_id)
    .maybeSingle();
  if (retailerError) throw retailerError;

  const phone = normalizeBdPhone(placed.delivery_phone ?? "");
  if (!phone) {
    return json(
      { error: "Delivery phone must be an 11-digit Bangladeshi mobile number (01XXXXXXXXX)." },
      400,
    );
  }

  const addressParts = [
    placed.delivery_address,
    placed.delivery_city,
    placed.delivery_postcode ? `Postcode ${placed.delivery_postcode}` : null,
  ].filter(Boolean);
  let recipientAddress = addressParts.join(", ").trim();
  if (recipientAddress.length < 10) {
    return json(
      { error: "Delivery address is too short for Pathao (need at least 10 characters)." },
      400,
    );
  }
  if (recipientAddress.length > 220) {
    recipientAddress = recipientAddress.slice(0, 220);
  }

  const recipientName = (retailer?.name || retailer?.email || "Retailer").trim().slice(0, 100);
  if (recipientName.length < 3) {
    return json({ error: "Retailer name is too short for Pathao shipping." }, 400);
  }

  const merchandiseTotal = round2(
    lines.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0),
  );
  const amountToCollect =
    placed.payment_method === "cod" ? Math.max(0, Math.round(merchandiseTotal)) : 0;
  const itemQuantity = Math.max(
    1,
    lines.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
  );
  const itemDescription = lines
    .map((item) => `${item.product_name ?? "Item"} x${item.quantity}`)
    .join("; ")
    .slice(0, 200);

  const storeId = await resolveStoreId();
  const token = await getAccessToken();

  const pathaoPayload: Record<string, unknown> = {
    store_id: storeId,
    merchant_order_id: orderId,
    recipient_name: recipientName,
    recipient_phone: phone,
    recipient_address: recipientAddress,
    delivery_type: 48,
    item_type: 2,
    item_quantity: Math.min(itemQuantity, 50),
    item_weight: String(itemWeight),
    item_description: itemDescription || "SoukCart order",
    amount_to_collect: amountToCollect,
  };
  if (notes || placed.notes) {
    pathaoPayload.special_instruction = [notes, placed.notes]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 200);
  }

  const created = await pathaoJson<{
    message?: string;
    type?: string;
    code?: number;
    data?: {
      consignment_id?: string;
      merchant_order_id?: string;
      order_status?: string;
      delivery_fee?: number;
    };
  }>("/aladdin/api/v1/orders", {
    method: "POST",
    token,
    body: pathaoPayload,
  });

  const consignmentId = created.data?.consignment_id?.trim();
  if (!consignmentId) {
    return json(
      {
        error:
          created.message || "Pathao accepted the request but did not return a consignment id.",
      },
      502,
    );
  }

  const trackingUrl = `https://merchant.pathao.com/tracking?consignment_id=${encodeURIComponent(consignmentId)}`;
  const { data: shipment, error: recordError } = await admin.rpc("service_create_pathao_shipment", {
    p_order_id: orderId,
    p_seller_id: sellerId,
    p_consignment_id: consignmentId,
    p_pathao_status: created.data?.order_status ?? "Pending",
    p_pathao_delivery_fee: created.data?.delivery_fee ?? null,
    p_tracking_url: trackingUrl,
    p_notes: notes,
    p_amount_to_collect: amountToCollect,
  });
  if (recordError) {
    console.error("Pathao booking succeeded but local shipment failed", recordError, consignmentId);
    return json(
      {
        error:
          "Pathao booked the parcel, but SoukCart could not save the shipment. Contact admin with consignment " +
          consignmentId,
        consignmentId,
      },
      500,
    );
  }

  return json({
    status: "shipped",
    provider: "pathao",
    consignmentId,
    shipment,
    amountToCollect,
    pathaoDeliveryFee: created.data?.delivery_fee ?? null,
  });
}

async function syncShipment(sellerId: string, body: Record<string, unknown>): Promise<Response> {
  const orderId = readText(body.orderId).trim();
  if (!orderId) return json({ error: "Choose an order to sync." }, 400);

  const seller = await loadSeller(sellerId);
  if (seller instanceof Response) return seller;

  const { data: shipment, error } = await admin
    .from("order_shipments")
    .select("id, consignment_id, seller_id, provider")
    .eq("order_id", orderId)
    .eq("seller_id", sellerId)
    .maybeSingle();
  if (error) throw error;
  if (!shipment?.consignment_id || shipment.provider !== "pathao") {
    return json({ error: "No Pathao consignment found for this order." }, 404);
  }

  const token = await getAccessToken();
  const info = await pathaoJson<{
    data?: {
      consignment_id?: string;
      merchant_order_id?: string;
      order_status?: string;
      order_status_slug?: string;
      updated_at?: string;
    };
  }>(`/aladdin/api/v1/orders/${encodeURIComponent(shipment.consignment_id)}/info`, {
    method: "GET",
    token,
  });

  const status = info.data?.order_status_slug || info.data?.order_status || "";
  const { data: applied, error: applyError } = await admin.rpc("service_apply_pathao_event", {
    p_consignment_id: shipment.consignment_id,
    p_merchant_order_id: info.data?.merchant_order_id ?? orderId,
    p_event: null,
    p_pathao_status: status,
    p_delivery_fee: null,
    p_collected_amount: null,
    p_message: status ? `Pathao status: ${status}` : "Synced from Pathao",
    p_occurred_at: info.data?.updated_at ? new Date(info.data.updated_at).toISOString() : null,
  });
  if (applyError) throw applyError;

  return json({ status: "synced", pathaoStatus: status, result: applied });
}

async function listStores(sellerId: string): Promise<Response> {
  const seller = await loadSeller(sellerId);
  if (seller instanceof Response) return seller;
  const token = await getAccessToken();
  const stores = await pathaoJson<Record<string, unknown>>("/aladdin/api/v1/stores", {
    method: "GET",
    token,
  });
  return json({ stores });
}

async function loadSeller(sellerId: string): Promise<{ id: string } | Response> {
  const { data, error } = await admin
    .from("users")
    .select("id, role")
    .eq("id", sellerId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.role !== "seller") {
    return json({ error: "A supplier account is required to ship with Pathao." }, 403);
  }

  const { data: profile, error: profileError } = await admin
    .from("supplier_profiles")
    .select("status")
    .eq("user_id", sellerId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.status !== "approved") {
    return json(
      { error: "Your supplier account must be approved before booking Pathao shipments." },
      403,
    );
  }

  return { id: sellerId };
}

async function resolveStoreId(): Promise<number> {
  if (configuredStoreId && /^\d+$/.test(configuredStoreId)) {
    return Number(configuredStoreId);
  }

  const token = await getAccessToken();
  const listed = await pathaoJson<{
    data?: { data?: Array<{ store_id?: number; is_active?: number }> };
  }>("/aladdin/api/v1/stores", { method: "GET", token });

  const stores = listed.data?.data ?? [];
  const active = stores.find((store) => store.is_active === 1 && store.store_id);
  if (active?.store_id) return active.store_id;
  if (stores[0]?.store_id) return stores[0].store_id;

  const cities = await pathaoJson<{ data?: { data?: Array<{ city_id?: number }> } }>(
    "/aladdin/api/v1/city-list",
    { method: "GET", token },
  );
  const cityId = cities.data?.data?.[0]?.city_id ?? 1;
  const zones = await pathaoJson<{ data?: { data?: Array<{ zone_id?: number }> } }>(
    `/aladdin/api/v1/cities/${cityId}/zone-list`,
    { method: "GET", token },
  );
  const zoneId = zones.data?.data?.[0]?.zone_id;
  if (!zoneId) {
    throw new Error(
      "No Pathao store is configured. Set PATHAO_STORE_ID or create a store in the Pathao merchant panel.",
    );
  }
  const areas = await pathaoJson<{ data?: { data?: Array<{ area_id?: number }> } }>(
    `/aladdin/api/v1/zones/${zoneId}/area-list`,
    { method: "GET", token },
  );
  const areaId = areas.data?.data?.[0]?.area_id;
  if (!areaId) {
    throw new Error("Pathao area list is empty; set PATHAO_STORE_ID manually.");
  }

  await pathaoJson("/aladdin/api/v1/stores", {
    method: "POST",
    token,
    body: {
      name: "SoukCart Hub",
      contact_name: "SoukCart Admin",
      contact_number: "01700000000",
      address: "House 123, Road 4, Sector 10, Uttara, Dhaka-1230, Bangladesh",
      city_id: cityId,
      zone_id: zoneId,
      area_id: areaId,
    },
  });

  const refreshed = await pathaoJson<{
    data?: { data?: Array<{ store_id?: number }> };
  }>("/aladdin/api/v1/stores", { method: "GET", token });
  const createdId = refreshed.data?.data?.[0]?.store_id;
  if (!createdId) {
    throw new Error(
      "Created a Pathao store but could not read its id yet. Wait for approval, then set PATHAO_STORE_ID.",
    );
  }
  return createdId;
}

async function getAccessToken(): Promise<string> {
  const { data: stored } = await admin.rpc("service_get_pathao_token");
  if (isRecord(stored) && typeof stored.accessToken === "string") {
    const expiresAt = typeof stored.expiresAt === "string" ? Date.parse(stored.expiresAt) : 0;
    if (expiresAt > Date.now() + 60_000) {
      return stored.accessToken;
    }
    if (typeof stored.refreshToken === "string" && stored.refreshToken) {
      try {
        return await issueToken({
          grant_type: "refresh_token",
          refresh_token: stored.refreshToken,
        });
      } catch (refreshError) {
        console.error("Pathao refresh failed; issuing a new password token", refreshError);
      }
    }
  }

  return await issueToken({
    grant_type: "password",
    username,
    password,
  });
}

async function issueToken(extra: Record<string, string>): Promise<string> {
  const response = await fetch(`${pathaoBase}/aladdin/api/v1/issue-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      ...extra,
    }),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok || !isRecord(payload) || typeof payload.access_token !== "string") {
    throw new Error(
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : "Pathao authentication failed.",
    );
  }

  const expiresIn =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? payload.expires_in
      : 432000;
  const refresh =
    typeof payload.refresh_token === "string" ? payload.refresh_token : (extra.refresh_token ?? "");
  await admin.rpc("service_upsert_pathao_token", {
    p_access_token: payload.access_token,
    p_refresh_token: refresh || payload.access_token,
    p_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  });

  return payload.access_token;
}

async function pathaoJson<T>(
  path: string,
  options: { method: "GET" | "POST"; token: string; body?: Record<string, unknown> },
): Promise<T> {
  const response = await fetch(`${pathaoBase}${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: "application/json",
      ...(options.method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: options.method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
  });

  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `Pathao request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

function normalizeBdPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  let phone = digits;
  if (phone.startsWith("880") && phone.length === 13) {
    phone = phone.slice(2);
  }
  if (phone.length === 10 && phone.startsWith("1")) {
    phone = `0${phone}`;
  }
  if (/^01\d{9}$/.test(phone)) return phone;
  return null;
}

async function authorize(request: Request): Promise<{ id: string } | Response> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
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
  if (legacyKey) return legacyKey;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed: unknown = JSON.parse(secretKeys);
      if (isRecord(parsed) && typeof parsed.default === "string") {
        return parsed.default;
      }
    } catch {
      // Fall through.
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
