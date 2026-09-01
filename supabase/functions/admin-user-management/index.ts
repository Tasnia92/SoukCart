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

const allowedRoles = new Set(["", "seller", "retailer", "admin"]);

type RequestBody = {
  action?: unknown;
  userId?: unknown;
  name?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
};

type Profile = {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
};

type DirectoryUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
};

type Caller = {
  id: string;
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
    switch (body.action) {
      case "list":
        return await listUsers();
      case "create":
        return await createUser(body);
      case "update":
        return await updateUser(body, caller);
      case "delete":
        return await deleteUser(body, caller);
      default:
        return json({ error: "Choose a valid admin action." }, 400);
    }
  } catch (error) {
    console.error("Admin user management failed", error);
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

async function listUsers(): Promise<Response> {
  const [authUsers, profiles] = await Promise.all([listAuthUsers(), listProfiles()]);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const users = authUsers
    .map((authUser) => toDirectoryUser(authUser, profileById.get(authUser.id)))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));

  return json({ users });
}

async function createUser(body: RequestBody): Promise<Response> {
  const name = readText(body.name).trim();
  const email = readText(body.email).trim().toLowerCase();
  const password = readText(body.password);
  const role = readText(body.role);

  const validationError = validateAccountFields(name, email, role);
  if (validationError) return validationError;
  if (password.length < 8 || password.length > 72) {
    return json({ error: "The password must be between 8 and 72 characters." }, 400);
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) {
    return json({ error: error?.message ?? "The user could not be created." }, 400);
  }

  const { data: profile, error: profileError } = await admin
    .from("users")
    .update({ name, email, role })
    .eq("id", data.user.id)
    .select("id, email, name, role, created_at")
    .single();
  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(data.user.id);
    return json({ error: "The user profile could not be created." }, 500);
  }

  return json({ user: toDirectoryUser(data.user, profile) }, 201);
}

async function updateUser(body: RequestBody, caller: Caller): Promise<Response> {
  const userId = readText(body.userId).trim();
  const name = readText(body.name).trim();
  const email = readText(body.email).trim().toLowerCase();
  const role = readText(body.role);

  if (!isUuid(userId)) {
    return json({ error: "Enter a valid user ID." }, 400);
  }
  const validationError = validateAccountFields(name, email, role);
  if (validationError) return validationError;
  if (userId === caller.id && role !== "admin") {
    return json({ error: "You cannot remove administrator access from your active account." }, 400);
  }

  const { data: existingData, error: existingError } = await admin.auth.admin.getUserById(userId);
  if (existingError || !existingData.user) {
    return json({ error: existingError?.message ?? "The user could not be found." }, 404);
  }

  const existingUser = existingData.user as AuthUser;
  const previousMetadata = isRecord(existingUser.user_metadata) ? existingUser.user_metadata : {};
  const { data: updatedData, error: authError } = await admin.auth.admin.updateUserById(userId, {
    email,
    user_metadata: { ...previousMetadata, name },
  });
  if (authError || !updatedData.user) {
    return json({ error: authError?.message ?? "The account could not be updated." }, 400);
  }

  const { data: profile, error: profileError } = await admin
    .from("users")
    .upsert({ id: userId, email, name, role }, { onConflict: "id" })
    .select("id, email, name, role, created_at")
    .single();
  if (profileError || !profile) {
    const rollback: { email?: string; user_metadata: Record<string, unknown> } = {
      user_metadata: previousMetadata,
    };
    if (existingUser.email) rollback.email = existingUser.email;
    const { error: rollbackError } = await admin.auth.admin.updateUserById(userId, rollback);
    if (rollbackError) {
      console.error("Admin user update rollback failed", rollbackError);
      return json(
        {
          error:
            "The profile update failed and the authentication change could not be rolled back. Reconcile this account in Supabase Auth before editing it again.",
        },
        500,
      );
    }
    return json({ error: "The profile could not be updated. No changes were saved." }, 500);
  }

  return json({ user: toDirectoryUser(updatedData.user as AuthUser, profile) });
}

function validateAccountFields(name: string, email: string, role: string): Response | null {
  if (!name || name.length > 100) {
    return json({ error: "Enter a name between 1 and 100 characters." }, 400);
  }
  if (!email || !email.includes("@") || email.length > 255) {
    return json({ error: "Enter a valid email address." }, 400);
  }
  if (!allowedRoles.has(role)) {
    return json({ error: "Choose a valid account type." }, 400);
  }
  return null;
}

async function deleteUser(body: RequestBody, caller: Caller): Promise<Response> {
  const userId = readText(body.userId).trim();
  if (!isUuid(userId)) {
    return json({ error: "Enter a valid user ID." }, 400);
  }
  if (userId === caller.id) {
    return json({ error: "You cannot delete the admin account you are using." }, 400);
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return json({ error: error.message }, 400);
  }

  return json({ deletedId: userId });
}

async function listAuthUsers(): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }
    users.push(...(data.users as AuthUser[]));
    if (data.users.length < perPage) {
      return users;
    }
    page += 1;
  }
}

async function listProfiles(): Promise<Profile[]> {
  const { data, error } = await admin.from("users").select("id, email, name, role, created_at");
  if (error) {
    throw error;
  }
  return (data ?? []) as Profile[];
}

function toDirectoryUser(authUser: AuthUser, profile: Profile | undefined): DirectoryUser {
  const metadata = isRecord(authUser.user_metadata) ? authUser.user_metadata : {};
  const metadataName = typeof metadata.name === "string" ? metadata.name : "";
  return {
    id: authUser.id,
    email: profile?.email ?? authUser.email ?? "",
    name: profile?.name || metadataName,
    role: profile?.role ?? "",
    created_at: profile?.created_at ?? authUser.created_at,
    last_sign_in_at: authUser.last_sign_in_at ?? null,
    email_confirmed_at: authUser.email_confirmed_at ?? null,
  };
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

type AuthUser = {
  id: string;
  email?: string;
  user_metadata: unknown;
  created_at: string;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
