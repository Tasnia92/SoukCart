import { describe, expect, it } from "vite-plus/test";
import {
  ADMIN_USERS_FUNCTION,
  invokeAdmin,
  loadAdminOverviewUsers,
  type AdminFunctionGateway,
  type AdminOverviewUser,
} from "./admin-overview-api.ts";

function user(overrides: Partial<AdminOverviewUser>): AdminOverviewUser {
  return {
    id: "user-1",
    email: "user@example.com",
    name: "User",
    role: "retailer",
    created_at: "2026-08-01T12:00:00.000Z",
    last_sign_in_at: null,
    email_confirmed_at: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("admin overview API", () => {
  it("uses the existing admin-user-management list contract", async () => {
    const users = [user({})];
    const requests: Array<{ functionName: string; body: Record<string, unknown> }> = [];
    const gateway: AdminFunctionGateway = {
      functions: {
        invoke: async <T>(functionName: string, { body }: { body: Record<string, unknown> }) => {
          requests.push({ functionName, body });
          return { data: { users } as T, error: null };
        },
      },
    };

    await expect(loadAdminOverviewUsers(gateway)).resolves.toEqual(users);
    expect(requests).toEqual([{ functionName: ADMIN_USERS_FUNCTION, body: { action: "list" } }]);
  });

  it("surfaces structured Edge Function errors before generic errors", async () => {
    const gateway: AdminFunctionGateway = {
      functions: {
        invoke: async () => ({
          data: null,
          error: {
            message: "Function failed",
            context: new Response(JSON.stringify({ error: "Admin access is required." })),
          },
        }),
      },
    };

    await expect(invokeAdmin({ action: "list" }, ADMIN_USERS_FUNCTION, gateway)).rejects.toThrow(
      "Admin access is required.",
    );
  });

  it("retains generic and no-data failures from the legacy contract", async () => {
    const unavailableGateway: AdminFunctionGateway = {
      functions: {
        invoke: async () => ({ data: null, error: { message: "Service unavailable" } }),
      },
    };
    const emptyGateway: AdminFunctionGateway = {
      functions: { invoke: async () => ({ data: null, error: null }) },
    };

    await expect(
      invokeAdmin({ action: "list" }, ADMIN_USERS_FUNCTION, unavailableGateway),
    ).rejects.toThrow("Service unavailable");
    await expect(
      invokeAdmin({ action: "list" }, ADMIN_USERS_FUNCTION, emptyGateway),
    ).rejects.toThrow("The admin service returned no data.");
  });
});
