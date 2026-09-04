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

type RequestBody = {
  action?: unknown;
  orderId?: unknown;
  status?: unknown;
  platformCharge?: unknown;
  deliveryCharge?: unknown;
};

const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"] as const;

type Caller = {
  id: string;
};

type ActivityLine = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  amount: number;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_email: string | null;
};

type ActivityOrder = {
  id: string;
  status: string;
  cancel_requested: boolean;
  cancellation_initiator: string | null;
  cancellation_reason: string | null;
  payment_status: string;
  payment_method: string;
  created_at: string;
  delivered_at: string | null;
  delivery_verified_at: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  platform_charge: number;
  delivery_charge: number;
  delivery_payment_status: string;
  refund_amount: number;
  manual_refund_status: string;
  refund_completed_at: string | null;
  retailer_id: string;
  retailer_name: string;
  retailer_email: string;
  total: number;
  lines: ActivityLine[];
};

type ActivitySummary = {
  orders: number;
  revenue: number;
  retailers: number;
  suppliers: number;
  units: number;
};

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
    const caller = await authorize(request);
    if (caller instanceof Response) {
      return caller;
    }

    const body = await readBody(request);
    if (body.action === "list") {
      return await listActivity();
    }
    if (body.action === "update-status") {
      return await updateStatus(caller, body);
    }
    if (body.action === "complete-refund") {
      return await completeRefund(caller, body);
    }
    return json({ error: "Choose a valid admin action." }, 400);
  } catch (error) {
    console.error("Admin order overview failed", error);
    return json({ error: "The admin service could not complete that request." }, 500);
  }
});

async function authorize(request: Request): Promise<Caller | Response> {
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

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) {
    throw profileError;
  }
  if (profile?.role !== "admin") {
    return json({ error: "Administrator access is required." }, 403);
  }

  return { id: data.user.id };
}

async function listActivity(): Promise<Response> {
  const { data, error } = await admin
    .from("orders")
    .select(
      "id, status, cancel_requested, cancellation_initiator, cancellation_reason, payment_status, payment_method, created_at, delivered_at, delivery_verified_at, delivery_phone, delivery_address, delivery_city, delivery_postcode, platform_charge, delivery_charge, delivery_payment_status, refund_amount, manual_refund_status, refund_completed_at, retailer_id, users!orders_retailer_id_fkey(name, email), order_items(id, product_id, quantity, unit_price, products(id, name, seller_id, users(name, email)))",
    )
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    throw error;
  }

  const orders: ActivityOrder[] = (data ?? []).map((row: OrderRow): ActivityOrder => {
    const retailer = pickRelation(row.users);
    const lines = (row.order_items ?? []).map((item: OrderItemRow): ActivityLine => {
      const product = isRecord(item.products) ? item.products : null;
      const supplier = product ? pickRelation(product.users) : null;
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unit_price);
      return {
        id: item.id,
        product_id: item.product_id,
        product_name: typeof product?.name === "string" ? product.name : "Unknown product",
        quantity,
        unit_price: unitPrice,
        amount: roundMoney(quantity * unitPrice),
        supplier_id: typeof product?.seller_id === "string" ? product.seller_id : null,
        supplier_name: typeof supplier?.name === "string" ? supplier.name : null,
        supplier_email: typeof supplier?.email === "string" ? supplier.email : null,
      };
    });
    return {
      id: row.id,
      status: row.status,
      cancel_requested: row.cancel_requested === true,
      cancellation_initiator: row.cancellation_initiator,
      cancellation_reason: row.cancellation_reason,
      payment_status: row.payment_status,
      payment_method: row.payment_method,
      created_at: row.created_at,
      delivered_at: row.delivered_at,
      delivery_verified_at: row.delivery_verified_at,
      delivery_phone: row.delivery_phone,
      delivery_address: row.delivery_address,
      delivery_city: row.delivery_city,
      delivery_postcode: row.delivery_postcode,
      platform_charge: Number(row.platform_charge ?? 0),
      delivery_charge: Number(row.delivery_charge ?? 0),
      delivery_payment_status:
        typeof row.delivery_payment_status === "string" ? row.delivery_payment_status : "unpaid",
      refund_amount: Number(row.refund_amount ?? 0),
      manual_refund_status: row.manual_refund_status ?? "not_required",
      refund_completed_at: row.refund_completed_at,
      retailer_id: row.retailer_id,
      retailer_name: typeof retailer?.name === "string" ? retailer.name : "Unknown retailer",
      retailer_email: typeof retailer?.email === "string" ? retailer.email : "",
      total: roundMoney(lines.reduce((sum, line) => sum + line.amount, 0)),
      lines,
    };
  });

  const summary: ActivitySummary = {
    orders: orders.length,
    revenue: roundMoney(
      orders
        .filter((order) => order.payment_status === "paid")
        .reduce((sum, order) => sum + order.total, 0),
    ),
    retailers: new Set(orders.map((order) => order.retailer_id)).size,
    suppliers: new Set(
      orders.flatMap((order) => order.lines.map((line) => line.supplier_id).filter(Boolean)),
    ).size,
    units: orders.reduce(
      (sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.quantity, 0),
      0,
    ),
  };

  return json({ summary, orders });
}

async function updateStatus(caller: Caller, body: RequestBody): Promise<Response> {
  const orderId = readUuid(body.orderId);
  const status = typeof body.status === "string" ? body.status : "";
  if (!orderId) {
    return json({ error: "A valid order is required." }, 400);
  }
  if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
    return json({ error: "Choose a valid order status." }, 400);
  }

  const platformCharge = readMoney(body.platformCharge);
  const deliveryCharge = readMoney(body.deliveryCharge);
  if (platformCharge === null || deliveryCharge === null) {
    return json({ error: "Cancellation charges must be valid non-negative amounts." }, 400);
  }

  const { data, error } = await admin.rpc("admin_update_order_status", {
    p_order_id: orderId,
    p_status: status,
    p_admin_id: caller.id,
    p_platform_charge: platformCharge,
    p_delivery_charge: deliveryCharge,
  });
  if (error) {
    return json({ error: error.message }, 400);
  }
  return json({ order: data });
}

async function completeRefund(caller: Caller, body: RequestBody): Promise<Response> {
  const orderId = readUuid(body.orderId);
  if (!orderId) {
    return json({ error: "A valid order is required." }, 400);
  }

  const { data, error } = await admin.rpc("admin_complete_manual_refund", {
    p_order_id: orderId,
    p_admin_id: caller.id,
  });
  if (error) {
    return json({ error: error.message }, 400);
  }
  return json({ order: data });
}

type OrderRow = {
  id: string;
  status: string;
  cancel_requested: boolean;
  cancellation_initiator: string | null;
  cancellation_reason: string | null;
  payment_status: string;
  payment_method: string;
  created_at: string;
  delivered_at: string | null;
  delivery_verified_at: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  platform_charge: number | string | null;
  delivery_charge: number | string | null;
  delivery_payment_status: string | null;
  refund_amount: number | string | null;
  manual_refund_status: string | null;
  refund_completed_at: string | null;
  retailer_id: string;
  users: unknown;
  order_items: OrderItemRow[] | null;
};

type OrderItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  products: unknown;
};

function pickRelation(value: unknown): { name?: unknown; email?: unknown } | null {
  const record = Array.isArray(value) ? value[0] : value;
  return isRecord(record) ? record : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function readMoney(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  const amount = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : null;
}

async function readBody(request: Request): Promise<RequestBody> {
  try {
    const body: unknown = await request.json();
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readUuid(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
    ? value
    : null;
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
