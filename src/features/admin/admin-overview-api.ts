import { supabase } from "../../supabase.ts";

export const ADMIN_USERS_FUNCTION = "admin-user-management";

export type AdminOverviewUser = {
  id: string;
  email: string;
  name: string;
  role: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
};

type AdminUsersResponse = {
  users: AdminOverviewUser[];
};

type AdminFunctionError = {
  message?: string;
  context?: unknown;
};

export type AdminFunctionGateway = {
  functions: {
    invoke: <T>(
      functionName: string,
      options: { body: Record<string, unknown> },
    ) => Promise<{ data: T | null; error: AdminFunctionError | null }>;
  };
};

const adminGateway = supabase as unknown as AdminFunctionGateway;

export async function invokeAdmin<T>(
  body: Record<string, unknown>,
  functionName = ADMIN_USERS_FUNCTION,
  gateway: AdminFunctionGateway = adminGateway,
): Promise<T> {
  const { data, error } = await gateway.functions.invoke<T>(functionName, { body });
  if (error) {
    const context = error.context;
    if (context instanceof Response) {
      try {
        const payload = (await context.json()) as { error?: unknown };
        if (typeof payload.error === "string") throw new Error(payload.error);
      } catch (responseError) {
        if (
          responseError instanceof Error &&
          responseError.message !== "Unexpected end of JSON input"
        ) {
          throw responseError;
        }
      }
    }
    throw new Error(error.message || "The admin service is unavailable.");
  }
  if (!data) throw new Error("The admin service returned no data.");
  return data;
}

export async function loadAdminOverviewUsers(
  gateway: AdminFunctionGateway = adminGateway,
): Promise<AdminOverviewUser[]> {
  const response = await invokeAdmin<AdminUsersResponse>(
    { action: "list" },
    ADMIN_USERS_FUNCTION,
    gateway,
  );
  return response.users;
}

export type AdminOverviewStats = {
  total: number;
  recentlyActive: number;
  newThisWeek: number;
  needsSetup: number;
};

export function getAdminOverviewStats(
  users: readonly AdminOverviewUser[],
  now = Date.now(),
): AdminOverviewStats {
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  return {
    total: users.length,
    recentlyActive: users.filter(
      (user) =>
        user.last_sign_in_at && now - new Date(user.last_sign_in_at).getTime() <= thirtyDays,
    ).length,
    newThisWeek: users.filter((user) => now - new Date(user.created_at).getTime() <= sevenDays)
      .length,
    needsSetup: users.filter((user) => !user.role).length,
  };
}
