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

const PRODUCT_IMAGES_BUCKET = "product-images";
const MAX_REASON_LENGTH = 1000;

type RequestBody = {
  action?: unknown;
  productId?: unknown;
  reason?: unknown;
};

type ModerationStatus = "ok" | "hidden" | "removed";
type ApprovalStatus = "pending" | "approved" | "rejected";

type ProductRow = {
  id: string;
  seller_id: string | null;
  name: string;
  description: string;
  price: number | string;
  unit: string;
  stock: number;
  min_order_qty: number;
  category: string | null;
  image_url: string | null;
  is_active: boolean;
  moderation_status: ModerationStatus;
  moderation_reason: string | null;
  moderated_by: string | null;
  moderated_at: string | null;
  approval_status: ApprovalStatus;
  approval_note: string | null;
  approved_at: string | null;
  created_at: string;
};

type ProfileRow = { id: string; name: string; email: string };
type ShopRow = { user_id: string; shop_name: string };
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
        return await listProducts();
      case "hide":
        return await moderate(body, caller, "hidden");
      case "remove":
        return await moderate(body, caller, "removed");
      case "restore":
        return await restore(body, caller);
      case "approve":
        return await reviewListing(body, caller, "approved");
      case "reject":
        return await reviewListing(body, caller, "rejected");
      default:
        return json({ error: "Choose a valid product moderation action." }, 400);
    }
  } catch (error) {
    console.error("Product moderation service failed", error);
    return json({ error: "The product moderation service could not complete that request." }, 500);
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

async function listProducts(): Promise<Response> {
  const { data, error } = await admin
    .from("products")
    .select(
      "id, seller_id, name, description, price, unit, stock, min_order_qty, category, image_url, is_active, moderation_status, moderation_reason, moderated_by, moderated_at, approval_status, approval_note, approved_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw error;

  const rows = (data ?? []) as ProductRow[];
  const sellerIds = [...new Set(rows.map((row) => row.seller_id).filter(Boolean))] as string[];
  const [profiles, shops] = await Promise.all([loadProfiles(sellerIds), loadShops(sellerIds)]);

  const products = rows.map((row) => {
    const profile = row.seller_id ? profiles.get(row.seller_id) : undefined;
    const shop = row.seller_id ? shops.get(row.seller_id) : undefined;
    return {
      id: row.id,
      seller_id: row.seller_id,
      name: row.name,
      description: row.description,
      price: Number(row.price),
      unit: row.unit,
      stock: row.stock,
      min_order_qty: row.min_order_qty,
      category: row.category,
      image_url: row.image_url,
      is_active: row.is_active,
      moderation_status: row.moderation_status ?? "ok",
      moderation_reason: row.moderation_reason,
      moderated_by: row.moderated_by,
      moderated_at: row.moderated_at,
      approval_status: row.approval_status ?? "approved",
      approval_note: row.approval_note,
      approved_at: row.approved_at,
      created_at: row.created_at,
      seller_name: profile?.name ?? "Unknown seller",
      seller_email: profile?.email ?? "",
      shop_name: shop?.shop_name ?? null,
    };
  });

  return json({ products });
}

async function moderate(
  body: RequestBody,
  caller: Caller,
  status: "hidden" | "removed",
): Promise<Response> {
  const productId = readText(body.productId).trim();
  const reason = readText(body.reason).trim();
  if (!isUuid(productId)) return json({ error: "Choose a valid product." }, 400);
  if (!reason)
    return json({ error: "Add a reason so the seller knows what violated the rules." }, 400);
  if (reason.length > MAX_REASON_LENGTH) {
    return json({ error: `Keep the reason under ${MAX_REASON_LENGTH} characters.` }, 400);
  }

  const { data: existing, error: fetchError } = await admin
    .from("products")
    .select("id, seller_id, name, image_url, moderation_status")
    .eq("id", productId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) return json({ error: "That product could not be found." }, 404);
  if (existing.moderation_status === "removed") {
    return json({ error: "This product has already been removed." }, 409);
  }

  const moderatedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("products")
    .update({
      is_active: false,
      moderation_status: status,
      moderation_reason: reason,
      moderated_by: caller.id,
      moderated_at: moderatedAt,
    })
    .eq("id", productId)
    .select("id, seller_id, name, image_url, moderation_status")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) return json({ error: "That product could not be found." }, 404);

  let purged = false;
  if (status === "removed") {
    purged = await maybeHardDelete(productId, updated.image_url);
  }

  if (updated.seller_id) {
    const title = status === "hidden" ? "Your product was hidden" : "Your product was removed";
    const message =
      status === "hidden"
        ? `"${updated.name}" was hidden by SoukCart for violating marketplace rules. Reason: ${reason}`
        : `"${updated.name}" was removed by SoukCart for violating marketplace rules. Reason: ${reason}`;
    const { error: notifyError } = await admin.from("notifications").insert({
      recipient_id: updated.seller_id,
      order_id: null,
      type: status === "hidden" ? "product_hidden" : "product_removed",
      title,
      message,
    });
    if (notifyError) {
      console.error("Could not notify the seller about product moderation", notifyError);
    }
  }

  return json({
    productId,
    moderation_status: status,
    purged,
  });
}

async function restore(body: RequestBody, caller: Caller): Promise<Response> {
  const productId = readText(body.productId).trim();
  if (!isUuid(productId)) return json({ error: "Choose a valid product." }, 400);

  const { data: existing, error: fetchError } = await admin
    .from("products")
    .select("id, seller_id, name, moderation_status")
    .eq("id", productId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) return json({ error: "That product could not be found." }, 404);
  if (existing.moderation_status !== "hidden") {
    return json(
      {
        error:
          existing.moderation_status === "removed"
            ? "Removed products cannot be restored."
            : "Only products hidden by an administrator can be restored.",
      },
      409,
    );
  }

  const { data: updated, error: updateError } = await admin
    .from("products")
    .update({
      is_active: true,
      moderation_status: "ok",
      moderation_reason: null,
      moderated_by: null,
      moderated_at: null,
    })
    .eq("id", productId)
    .eq("moderation_status", "hidden")
    .select("id, seller_id, name")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) {
    return json({ error: "Only products hidden by an administrator can be restored." }, 409);
  }

  if (updated.seller_id) {
    const { error: notifyError } = await admin.from("notifications").insert({
      recipient_id: updated.seller_id,
      order_id: null,
      type: "product_restored",
      title: "Your product was restored",
      message: `"${updated.name}" is visible in the catalog again after an administrator review.`,
    });
    if (notifyError) {
      console.error("Could not notify the seller about product restore", notifyError);
    }
  }

  return json({ productId, moderation_status: "ok", restoredBy: caller.id });
}

/**
 * Approve or reject a listing that is waiting for review. The seller-facing
 * notification is raised by the `products_notify_approval_change` database
 * trigger, so the edge function only records the decision.
 */
async function reviewListing(
  body: RequestBody,
  caller: Caller,
  status: "approved" | "rejected",
): Promise<Response> {
  const productId = readText(body.productId).trim();
  const reason = readText(body.reason).trim();
  if (!isUuid(productId)) return json({ error: "Choose a valid product." }, 400);
  if (status === "rejected") {
    if (!reason) {
      return json({ error: "Add a reason so the seller knows what to fix." }, 400);
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return json({ error: `Keep the reason under ${MAX_REASON_LENGTH} characters.` }, 400);
    }
  }

  const { data: existing, error: fetchError } = await admin
    .from("products")
    .select("id, name, seller_id, approval_status")
    .eq("id", productId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) return json({ error: "That product could not be found." }, 404);
  if (existing.approval_status !== "pending") {
    return json({ error: "Only products waiting for approval can be reviewed." }, 409);
  }

  const { data: updated, error: updateError } = await admin
    .from("products")
    .update({
      approval_status: status,
      approval_note: status === "rejected" ? reason : null,
      approved_by: caller.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", productId)
    .eq("approval_status", "pending")
    .select("id, approval_status")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) {
    return json({ error: "Only products waiting for approval can be reviewed." }, 409);
  }

  return json({ productId, approval_status: status });
}

async function maybeHardDelete(productId: string, imageUrl: string | null): Promise<boolean> {
  const { count, error: countError } = await admin
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);
  if (countError) {
    console.error("Could not check order items before purge", countError);
    return false;
  }
  if ((count ?? 0) > 0) return false;

  const { error: deleteError } = await admin.from("products").delete().eq("id", productId);
  if (deleteError) {
    console.error("Could not hard-delete unused moderated product", deleteError);
    return false;
  }

  if (imageUrl) {
    const objectPath = extractObjectPath(imageUrl);
    if (objectPath) {
      const { error: storageError } = await admin.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .remove([objectPath]);
      if (storageError) {
        console.error("Could not remove product image after purge", storageError);
      }
    }
  }

  return true;
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

async function loadShops(userIds: readonly string[]): Promise<Map<string, ShopRow>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await admin
    .from("supplier_profiles")
    .select("user_id, shop_name")
    .in("user_id", userIds as string[]);
  if (error) throw error;
  return new Map((data as ShopRow[]).map((shop) => [shop.user_id, shop]));
}

function extractObjectPath(url: string): string | null {
  const marker = `/object/public/${PRODUCT_IMAGES_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(url.slice(index + marker.length).split("?")[0] ?? "");
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
