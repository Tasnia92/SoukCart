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
  payment_status: string;
  payment_method: string;
  created_at: string;
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
      return await updateStatus(body);
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
      "id, status, cancel_requested, payment_status, payment_method, created_at, users(name, email), order_items(id, product_id, quantity, unit_price, products(id, name, seller_id, users(name, email)))",
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
      payment_status: row.payment_status,
      payment_method: row.payment_method,
      created_at: row.created_at,
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

async function updateStatus(body: RequestBody): Promise<Response> {
  const orderId = readUuid(body.orderId);
  const status = typeof body.status === "string" ? body.status : "";
  if (!orderId) {
    return json({ error: "A valid order is required." }, 400);
  }
  if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
    return json({ error: "Choose a valid order status." }, 400);
  }

  const { data: existing, error: fetchError } = await admin
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (fetchError) {
    throw fetchError;
  }
  if (!existing) {
    return json({ error: "Order not found." }, 404);
  }

  const { data, error } = await admin
    .from("orders")
    .update({
      status,
      // Setting a status resolves any pending cancellation request: the same
      // status clears (rejects) it, "cancelled" approves it.
      cancel_requested: false,
      cancel_requested_at: null,
    })
    .eq("id", orderId)
    .select("id, status, cancel_requested")
    .single();
  if (error) {
    // Surface database guardrails (e.g. the stock trigger) to the admin.
    return json({ error: error.message }, 400);
  }
  return json({ order: data });
}

type OrderRow = {
  id: string;
  status: string;
  cancel_requested: boolean;
  payment_status: string;
  payment_method: string;
  created_at: string;
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
