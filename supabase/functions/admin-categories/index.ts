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

const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 280;
const MAX_SORT_ORDER = 10000;

type RequestBody = {
  action?: unknown;
  categoryId?: unknown;
  name?: unknown;
  description?: unknown;
  sortOrder?: unknown;
  isActive?: unknown;
};

type CategoryRow = {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type CountRow = { category: string | null; product_count: number | string };
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
        return await listCategories();
      case "create":
        return await createCategory(body, caller);
      case "update":
        return await updateCategory(body);
      case "delete":
        return await deleteCategory(body);
      default:
        return json({ error: "Choose a valid category action." }, 400);
    }
  } catch (error) {
    console.error("Admin categories service failed", error);
    return json({ error: "The category service could not complete that request." }, 500);
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

async function listCategories(): Promise<Response> {
  const { data, error } = await admin
    .from("categories")
    .select("id, name, description, sort_order, is_active, created_by, created_at, updated_at")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;

  const counts = await loadProductCounts();
  const categories = ((data ?? []) as CategoryRow[]).map((row) => ({
    ...row,
    product_count: counts.get(normalizeName(row.name)) ?? 0,
  }));

  return json({ categories });
}

async function createCategory(body: RequestBody, caller: Caller): Promise<Response> {
  const name = readText(body.name).trim();
  if (!name) return json({ error: "Give the category a name." }, 400);
  if (name.length > MAX_NAME_LENGTH) {
    return json({ error: `Keep the name under ${MAX_NAME_LENGTH} characters.` }, 400);
  }
  const description = readText(body.description).trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return json({ error: `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.` }, 400);
  }
  const sortOrder = readSortOrder(body.sortOrder);
  if (sortOrder === null) {
    return json({ error: "Sort order must be a whole number between 0 and 10000." }, 400);
  }

  const { data: inserted, error: insertError } = await admin
    .from("categories")
    .insert({ name, description, sort_order: sortOrder, created_by: caller.id })
    .select("id, name, description, sort_order, is_active, created_by, created_at, updated_at")
    .maybeSingle();
  if (insertError) {
    if (isUniqueViolation(insertError)) {
      return json({ error: `A category named "${name}" already exists.` }, 409);
    }
    throw insertError;
  }
  if (!inserted) return json({ error: "The category could not be created." }, 500);

  return json({ category: { ...inserted, product_count: 0 } });
}

async function updateCategory(body: RequestBody): Promise<Response> {
  const categoryId = readText(body.categoryId).trim();
  if (!isUuid(categoryId)) return json({ error: "Choose a valid category." }, 400);

  const { data: existing, error: fetchError } = await admin
    .from("categories")
    .select("id, name, description, sort_order, is_active, created_by, created_at, updated_at")
    .eq("id", categoryId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) return json({ error: "That category could not be found." }, 404);

  const patch: {
    name?: string;
    description?: string;
    sort_order?: number;
    is_active?: boolean;
  } = {};
  const rawName = readText(body.name).trim();
  if (rawName && normalizeName(rawName) !== normalizeName(existing.name)) {
    if (rawName.length > MAX_NAME_LENGTH) {
      return json({ error: `Keep the name under ${MAX_NAME_LENGTH} characters.` }, 400);
    }
    const duplicate = await findDuplicateName(rawName, categoryId);
    if (duplicate) {
      return json({ error: `A category named "${duplicate.name}" already exists.` }, 409);
    }
    patch.name = rawName;
  }
  if (body.description !== undefined) {
    const rawDescription = readText(body.description).trim();
    if (rawDescription.length > MAX_DESCRIPTION_LENGTH) {
      return json(
        { error: `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.` },
        400,
      );
    }
    if (rawDescription !== existing.description) patch.description = rawDescription;
  }
  if (body.sortOrder !== undefined) {
    const rawSortOrder = readSortOrder(body.sortOrder);
    if (rawSortOrder === null) {
      return json({ error: "Sort order must be a whole number between 0 and 10000." }, 400);
    }
    if (rawSortOrder !== existing.sort_order) patch.sort_order = rawSortOrder;
  }
  if (body.isActive !== undefined) {
    const rawIsActive = body.isActive === true;
    if (rawIsActive !== existing.is_active) patch.is_active = rawIsActive;
  }

  if (Object.keys(patch).length === 0) {
    const counts = await loadProductCounts();
    return json({ category: withCount(existing, counts) });
  }

  // Renaming: move matching product text values first so a failed rename can
  // simply be retried, then update the category row itself.
  let movedProducts = 0;
  if (typeof patch.name === "string") {
    const { count, error: renameError } = await admin
      .from("products")
      .update({ category: patch.name }, { count: "exact" })
      .eq("category", existing.name);
    if (renameError) throw renameError;
    movedProducts = count ?? 0;
  }

  const { data: updated, error: updateError } = await admin
    .from("categories")
    .update(patch)
    .eq("id", categoryId)
    .select("id, name, description, sort_order, is_active, created_by, created_at, updated_at")
    .maybeSingle();
  if (updateError) {
    if (isUniqueViolation(updateError)) {
      const conflictName = patch.name ?? existing.name;
      return json({ error: `A category named "${conflictName}" already exists.` }, 409);
    }
    throw updateError;
  }
  if (!updated) return json({ error: "That category could not be found." }, 404);

  const counts = await loadProductCounts();
  return json({ category: withCount(updated, counts), movedProducts });
}

async function deleteCategory(body: RequestBody): Promise<Response> {
  const categoryId = readText(body.categoryId).trim();
  if (!isUuid(categoryId)) return json({ error: "Choose a valid category." }, 400);

  const { data: existing, error: fetchError } = await admin
    .from("categories")
    .select("id, name")
    .eq("id", categoryId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) return json({ error: "That category could not be found." }, 404);

  // Clear matching product text values first so a failed delete can be retried.
  const { count: cleared, error: clearError } = await admin
    .from("products")
    .update({ category: null }, { count: "exact" })
    .eq("category", existing.name);
  if (clearError) throw clearError;

  const { error: deleteError } = await admin.from("categories").delete().eq("id", categoryId);
  if (deleteError) throw deleteError;

  return json({ categoryId, clearedProducts: cleared ?? 0 });
}

async function loadProductCounts(): Promise<Map<string, number>> {
  const { data, error } = await admin.rpc("category_product_counts");
  if (error) {
    console.error("Could not load product counts per category", error);
    return new Map();
  }
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as CountRow[]) {
    if (row.category) counts.set(normalizeName(row.category), Number(row.product_count));
  }
  return counts;
}

async function findDuplicateName(
  name: string,
  excludeId: string,
): Promise<{ name: string } | null> {
  const { data, error } = await admin.from("categories").select("id, name");
  if (error) throw error;
  const needle = normalizeName(name);
  return (
    ((data ?? []) as { id: string; name: string }[]).find(
      (row) => row.id !== excludeId && normalizeName(row.name) === needle,
    ) ?? null
  );
}

function withCount(row: CategoryRow, counts: Map<string, number>) {
  return { ...row, product_count: counts.get(normalizeName(row.name)) ?? 0 };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function readSortOrder(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(readText(value));
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SORT_ORDER) return null;
  return parsed;
}

function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === "23505";
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
