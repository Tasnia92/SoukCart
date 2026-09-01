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
  complaintId?: unknown;
  status?: unknown;
};

type Caller = { id: string };

type Complaint = {
  id: string;
  order_id: string | null;
  category: string;
  subject: string;
  description: string;
  attachment_url: string | null;
  status: string;
  created_at: string;
  retailer_id: string;
  retailer_name: string;
  retailer_email: string;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = getServiceKey();
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
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
    switch (body.action) {
      case "list":
        return await listComplaints();
      case "update":
        return await updateComplaint(body);
      default:
        return json({ error: "Choose a valid admin action." }, 400);
    }
  } catch (error) {
    console.error("Admin complaints failed", error);
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

async function listComplaints(): Promise<Response> {
  const { data, error } = await admin
    .from("complaints")
    .select(
      "id, order_id, category, subject, description, attachment_url, status, created_at, retailer_id, users(name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    throw error;
  }

  const complaints: Complaint[] = (data ?? []).map((row: ComplaintRow): Complaint => {
    const retailer = pickRelation(row.users);
    return {
      id: row.id,
      order_id: row.order_id,
      category: row.category,
      subject: row.subject,
      description: row.description,
      attachment_url: row.attachment_url,
      status: row.status,
      created_at: row.created_at,
      retailer_id: row.retailer_id,
      retailer_name: typeof retailer?.name === "string" ? retailer.name : "Unknown retailer",
      retailer_email: typeof retailer?.email === "string" ? retailer.email : "",
    };
  });

  return json({ complaints });
}

async function updateComplaint(body: RequestBody): Promise<Response> {
  const complaintId = readText(body.complaintId).trim();
  const status = readText(body.status);
  if (!isUuid(complaintId)) {
    return json({ error: "Enter a valid complaint ID." }, 400);
  }
  if (status !== "open" && status !== "resolved") {
    return json({ error: "Choose a valid status." }, 400);
  }

  const { data, error } = await admin
    .from("complaints")
    .update({ status })
    .eq("id", complaintId)
    .select("id, status")
    .single();
  if (error || !data) {
    return json({ error: error?.message ?? "The complaint could not be updated." }, 400);
  }

  return json({ complaint: data });
}

type ComplaintRow = {
  id: string;
  order_id: string | null;
  category: string;
  subject: string;
  description: string;
  attachment_url: string | null;
  status: string;
  created_at: string;
  retailer_id: string;
  users: unknown;
};

function pickRelation(value: unknown): { name?: unknown; email?: unknown } | null {
  const record = Array.isArray(value) ? value[0] : value;
  return isRecord(record) ? record : null;
}

async function readBody(request: Request): Promise<RequestBody> {
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
