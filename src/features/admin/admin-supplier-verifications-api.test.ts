import { describe, expect, it } from "vite-plus/test";
import type { AdminFunctionGateway } from "./admin-overview-api.ts";
import {
  approveSupplier,
  filterVerifications,
  getVerificationStats,
  loadSupplierVerifications,
  rejectSupplier,
  sortVerificationsForReview,
  type AdminSupplierVerification,
} from "./admin-supplier-verifications-api.ts";

function verification(
  overrides: Partial<AdminSupplierVerification> = {},
): AdminSupplierVerification {
  return {
    user_id: "seller-1",
    shop_name: "Rahman Traders",
    shop_details: "Wholesale rice and pulses.",
    location: "Karwan Bazar, Dhaka",
    status: "pending",
    review_note: null,
    reviewed_at: null,
    created_at: "2026-09-01T09:00:00.000Z",
    updated_at: "2026-09-01T09:00:00.000Z",
    supplier_name: "Abdur Rahman",
    supplier_email: "rahman@example.com",
    trade_license_url: "https://signed.example/licence.pdf",
    ...overrides,
  };
}

function recordingGateway(): {
  gateway: AdminFunctionGateway;
  calls: Array<{ fn: string; body: Record<string, unknown> }>;
} {
  const calls: Array<{ fn: string; body: Record<string, unknown> }> = [];
  const gateway = {
    functions: {
      invoke: async <T>(fn: string, options: { body: Record<string, unknown> }) => {
        calls.push({ fn, body: options.body });
        return { data: { verifications: [] } as unknown as T, error: null };
      },
    },
  } as AdminFunctionGateway;
  return { gateway, calls };
}

describe("admin supplier verifications API", () => {
  it("invokes the verification function for list/approve/reject", async () => {
    const { gateway, calls } = recordingGateway();

    await loadSupplierVerifications(gateway);
    await approveSupplier("11111111-1111-1111-1111-111111111111", gateway);
    await rejectSupplier("22222222-2222-2222-2222-222222222222", "Blurry licence", gateway);

    expect(calls).toEqual([
      { fn: "admin-supplier-verifications", body: { action: "list" } },
      {
        fn: "admin-supplier-verifications",
        body: { action: "approve", userId: "11111111-1111-1111-1111-111111111111" },
      },
      {
        fn: "admin-supplier-verifications",
        body: {
          action: "reject",
          userId: "22222222-2222-2222-2222-222222222222",
          note: "Blurry licence",
        },
      },
    ]);
  });

  it("filters by shop, supplier, and location text", () => {
    const rows = [
      verification({ user_id: "a", shop_name: "Rahman Traders" }),
      verification({
        user_id: "b",
        shop_name: "City Grocers",
        location: "Chittagong",
        supplier_name: "Karim Uddin",
        supplier_email: "karim@example.com",
      }),
    ];
    expect(filterVerifications(rows, "chittagong").map((row) => row.user_id)).toEqual(["b"]);
    expect(filterVerifications(rows, "rahman").map((row) => row.user_id)).toEqual(["a"]);
    expect(filterVerifications(rows, "")).toHaveLength(2);
  });

  it("counts applications by status", () => {
    const rows = [
      verification({ status: "pending" }),
      verification({ status: "approved" }),
      verification({ status: "approved" }),
      verification({ status: "rejected" }),
    ];
    expect(getVerificationStats(rows)).toEqual({
      total: 4,
      pending: 1,
      approved: 2,
      rejected: 1,
    });
  });

  it("orders pending applications first (FIFO), then decided newest-first", () => {
    const rows = [
      verification({
        user_id: "approved-new",
        status: "approved",
        updated_at: "2026-09-05T00:00:00.000Z",
      }),
      verification({
        user_id: "pending-late",
        status: "pending",
        created_at: "2026-09-03T00:00:00.000Z",
      }),
      verification({
        user_id: "pending-early",
        status: "pending",
        created_at: "2026-09-01T00:00:00.000Z",
      }),
      verification({
        user_id: "rejected-old",
        status: "rejected",
        updated_at: "2026-09-02T00:00:00.000Z",
      }),
    ];
    expect(sortVerificationsForReview(rows).map((row) => row.user_id)).toEqual([
      "pending-early",
      "pending-late",
      "approved-new",
      "rejected-old",
    ]);
  });
});
