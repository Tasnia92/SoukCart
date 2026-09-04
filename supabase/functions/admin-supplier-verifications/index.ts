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

const TRADE_LICENSES_BUCKET = "trade-licenses";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

type RequestBody = {
  action?: unknown;
  userId?: unknown;
  note?: unknown;
};

type SupplierRow = {
  user_id: string;
  shop_name: string;
  shop_details: string;
  location: string;
  trade_license_number: string;
  nid_front_path: string;
  nid_back_path: string;
  contact_phone: string;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileRow = { id: string; name: string; email: string };

type Caller = { id: string };

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const admin = createClient(supabaseUrl, getServiceKey(), {
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
    if (caller instanceof Response) return caller;

    const body = await readBody(request);
    switch (body.action) {
      case "list":
        return await listVerifications();
      case "approve":
        return await review(body, caller, "approved");
      case "reject":
        return await review(body, caller, "rejected");
      default:
        return json({ error: "Choose a valid verification action." }, 400);
    }
  } catch (error) {
    console.error("Supplier verification service failed", error);
    return json({ error: "The verification service could not complete that request." }, 500);
  }
});

async function authorize(request: Request): Promise<Caller | Response> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Authentication is required." }, 401);
  }
  const token = authorization.slice(7).trim();
  if (!token) return json({ error: "Authentication is required." }, 401);

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json({ error: "Your session is no longer valid." }, 401);

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (profile?.role !== "admin") {
    return json({ error: "Administrator access is required." }, 403);
  }
  return { id: data.user.id };
}

async function listVerifications(): Promise<Response> {
  const { data: rows, error } = await admin
    .from("supplier_profiles")
    .select(
      "user_id, shop_name, shop_details, location, trade_license_number, nid_front_path, nid_back_path, contact_phone, status, review_note, reviewed_by, reviewed_at, created_at, updated_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;

  const supplierRows = (rows ?? []) as SupplierRow[];
  const profileById = await loadProfiles(supplierRows.map((row) => row.user_id));

  const verifications = await Promise.all(
    supplierRows.map(async (row) => {
      const profile = profileById.get(row.user_id);
      return {
        user_id: row.user_id,
        shop_name: row.shop_name,
        shop_details: row.shop_details,
        location: row.location,
        trade_license_number: row.trade_license_number ?? "",
        contact_phone: row.contact_phone ?? "",
        status: row.status,
        review_note: row.review_note,
        reviewed_at: row.reviewed_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        supplier_name: profile?.name ?? "",
        supplier_email: profile?.email ?? "",
        nid_front_url: await signDocument(row.nid_front_path),
        nid_back_url: await signDocument(row.nid_back_path),
      };
    }),
  );

  return json({ verifications });
}

async function review(
  body: RequestBody,
  caller: Caller,
  status: "approved" | "rejected",
): Promise<Response> {
  const userId = readText(body.userId).trim();
  const note = readText(body.note).trim();
  if (!isUuid(userId)) return json({ error: "Enter a valid supplier ID." }, 400);
  if (status === "rejected" && !note) {
    return json({ error: "Add a short reason so the supplier knows what to fix." }, 400);
  }
  if (note.length > 1000) {
    return json({ error: "Keep the review note under 1000 characters." }, 400);
  }

  // A decision is only allowed while the application is still pending. Once it
  // has been approved or rejected it is locked: the supplier must edit and
  // resubmit (which moves it back to pending) before an admin can review — and
  // in particular reject — it again.
  const { data: existing, error: fetchError } = await admin
    .from("supplier_profiles")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) return json({ error: "That supplier application could not be found." }, 404);
  if (existing.status !== "pending") {
    return json(
      {
        error:
          "This application has already been reviewed. The supplier must resubmit before it can be reviewed again.",
      },
      409,
    );
  }

  const { data, error } = await admin
    .from("supplier_profiles")
    .update({
      status,
      review_note: note || null,
      reviewed_by: caller.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("user_id, status")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return json(
      {
        error:
          "This application has already been reviewed. The supplier must resubmit before it can be reviewed again.",
      },
      409,
    );
  }

  if (status === "approved") {
    const { error: notifyError } = await admin.from("notifications").insert({
      recipient_id: userId,
      order_id: null,
      type: "supplier_verified",
      title: "Your shop is verified",
      message:
        "You are now a verified SoukCart seller. A checkmark appears next to your name on the dashboard.",
    });
    if (notifyError) {
      console.error("Could not notify the verified supplier", notifyError);
    }
  }

  return json({ userId, status });
}

async function loadProfiles(userIds: readonly string[]): Promise<Map<string, ProfileRow>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await admin
    .from("users")
    .select("id, name, email")
    .in("id", userIds as string[]);
  if (error) throw error;
  return new Map((data as ProfileRow[]).map((profile) => [profile.id, profile]));
}

async function signDocument(path: string): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await admin.storage
    .from(TRADE_LICENSES_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    console.error("Could not sign supplier document", error);
    return null;
  }
  return data.signedUrl;
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
  if (legacyKey) return legacyKey;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed: unknown = JSON.parse(secretKeys);
      if (isRecord(parsed) && typeof parsed.default === "string") return parsed.default;
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
