import { describe, expect, it } from "vite-plus/test";
import type { ActivityOrder, ActivityResponse } from "./admin-activity-api.ts";
import type { AdminComplaint } from "./admin-complaints-api.ts";
import type { AdminOverviewUser } from "./admin-overview-api.ts";
import type { AdminSupplierVerification } from "./admin-supplier-verifications-api.ts";
import {
  ADMIN_DISPUTES_SECTION,
  ADMIN_VERIFICATIONS_SECTION,
  buildAdminDashboard,
  loadAdminDashboard,
  slaBucketFor,
} from "./admin-dashboard-api.ts";

const now = Date.parse("2026-09-02T12:00:00.000Z");
const DAY = 86_400_000;

function iso(offsetDays: number, offsetMs = 0): string {
  return new Date(now - offsetDays * DAY - offsetMs).toISOString();
}

function order(overrides: Partial<ActivityOrder>): ActivityOrder {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    status: "confirmed",
    cancel_requested: false,
    cancellation_initiator: null,
    cancellation_reason: null,
    payment_status: "paid",
    payment_method: "online",
    created_at: iso(1),
    delivered_at: null,
    delivery_verified_at: null,
    delivery_phone: "01700000000",
    delivery_address: "12 Road",
    delivery_city: "Dhaka",
    delivery_postcode: "1205",
    platform_charge: 0,
    delivery_charge: 0,
    refund_amount: 0,
    manual_refund_status: "not_required",
    refund_completed_at: null,
    retailer_id: "retailer-1",
    retailer_name: "Rani Retail",
    retailer_email: "rani@example.com",
    total: 100,
    lines: [],
    ...overrides,
  };
}

function user(overrides: Partial<AdminOverviewUser>): AdminOverviewUser {
  return {
    id: "user-1",
    email: "user@example.com",
    name: "User",
    role: "retailer",
    created_at: iso(40),
    last_sign_in_at: null,
    email_confirmed_at: iso(40),
    ...overrides,
  };
}

function complaint(overrides: Partial<AdminComplaint>): AdminComplaint {
  return {
    id: "complaint-1",
    order_id: null,
    category: "general",
    subject: "Late delivery",
    description: "Still waiting",
    attachment_url: null,
    status: "open",
    created_at: iso(2),
    retailer_id: "retailer-1",
    retailer_name: "Rani Retail",
    retailer_email: "rani@example.com",
    ...overrides,
  };
}

function verification(overrides: Partial<AdminSupplierVerification>): AdminSupplierVerification {
  return {
    user_id: "seller-1",
    shop_name: "Samira Spices",
    shop_details: "Wholesale spices",
    location: "Dhaka",
    trade_license_number: "TRAD/DNCC/5678/2024",
    contact_phone: "01812345678",
    status: "pending",
    review_note: null,
    reviewed_at: null,
    created_at: iso(1),
    updated_at: iso(1),
    supplier_name: "Samira Supplier",
    supplier_email: "samira@example.com",
    nid_front_url: null,
    nid_back_url: null,
    ...overrides,
  };
}

describe("buildAdminDashboard", () => {
  it("reports GMV order value for the window and excludes cancelled orders", () => {
    const dashboard = buildAdminDashboard(
      {
        orders: [
          order({ id: "in-window", total: 400, created_at: iso(5) }),
          order({
            id: "unpaid",
            total: 80,
            created_at: iso(5),
            payment_status: "unpaid",
          }),
          order({ id: "cancelled", total: 900, created_at: iso(5), status: "cancelled" }),
          order({ id: "previous", total: 200, created_at: iso(40) }),
          order({ id: "ancient", total: 5000, created_at: iso(120) }),
        ],
        users: [],
        complaints: [],
      },
      now,
    );

    expect(dashboard.summary.orderValue).toBe(480);
    expect(dashboard.summary.paidOrderValue).toBe(400);
    expect(dashboard.summary.orders).toBe(2);
    // 480 against the previous window's 200.
    expect(dashboard.summary.orderValueDelta.percent).toBe(140);
    expect(dashboard.series).toHaveLength(30);
    expect(dashboard.series.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(480);
  });

  it("does not queue unpaid or failed online orders for confirmation", () => {
    const dashboard = buildAdminDashboard(
      {
        orders: [
          order({ id: "paid-pending", status: "pending", payment_status: "paid" }),
          order({
            id: "unpaid-online",
            status: "pending",
            payment_status: "unpaid",
            payment_method: "online",
          }),
          order({
            id: "failed-online",
            status: "pending",
            payment_status: "failed",
            payment_method: "online",
          }),
          order({
            id: "cod-pending",
            status: "pending",
            payment_status: "unpaid",
            payment_method: "cod",
          }),
        ],
        users: [],
        complaints: [],
      },
      now,
    );

    expect(dashboard.summary.pendingOrders).toBe(2);
    expect(
      dashboard.queue
        .filter((item) => item.kind === "confirmation")
        .map((item) => item.recordId)
        .sort(),
    ).toEqual(["cod-pending", "paid-pending"]);
  });

  it("counts each blocked order once across pending, cancellation and refund work", () => {
    const dashboard = buildAdminDashboard(
      {
        orders: [
          order({ id: "pending", status: "pending" }),
          // One order that is both cancel-requested and refund-blocked must not count twice.
          order({
            id: "both",
            status: "confirmed",
            cancel_requested: true,
            manual_refund_status: "pending",
          }),
          order({ id: "settled", status: "delivered" }),
        ],
        users: [],
        complaints: [complaint({ id: "open" }), complaint({ id: "closed", status: "resolved" })],
      },
      now,
    );

    expect(dashboard.summary.pendingOrders).toBe(1);
    expect(dashboard.summary.cancellationRequests).toBe(1);
    expect(dashboard.summary.refundsToComplete).toBe(1);
    expect(dashboard.summary.ordersAwaitingAction).toBe(2);
    expect(dashboard.summary.openDisputes).toBe(1);
    expect(dashboard.summary.totalDisputes).toBe(2);
  });

  it("keeps the account boundaries the overview used before", () => {
    const dashboard = buildAdminDashboard(
      {
        orders: [],
        users: [
          user({ id: "active-at-boundary", last_sign_in_at: iso(30) }),
          user({ id: "inactive", last_sign_in_at: iso(30, 1) }),
          user({ id: "new-at-boundary", created_at: iso(7) }),
          user({ id: "old", created_at: iso(7, 1), role: null }),
          user({ id: "empty-role", role: "" }),
        ],
        complaints: [],
      },
      now,
    );

    expect(dashboard.summary.accounts).toBe(5);
    expect(dashboard.summary.activeAccounts).toBe(1);
    expect(dashboard.summary.newAccounts).toBe(1);
    expect(dashboard.summary.accountsNeedingSetup).toBe(2);
  });

  it("orders the queue by cost of delay and includes record ids", () => {
    const refunds = Array.from({ length: 5 }, (_unused, index) =>
      order({
        id: `refund-${index}`,
        manual_refund_status: "review_required",
        created_at: iso(index + 1),
      }),
    );
    const dashboard = buildAdminDashboard(
      {
        orders: [
          ...refunds,
          order({ id: "cancel", cancel_requested: true, created_at: iso(1) }),
          order({ id: "cancel-2", cancel_requested: true, created_at: iso(2) }),
          order({ id: "pending", status: "pending", created_at: iso(1) }),
        ],
        users: [],
        complaints: [complaint({ id: "dispute" })],
        verifications: [verification({})],
      },
      now,
    );

    expect(dashboard.queue.filter((item) => item.kind === "refund")).toHaveLength(5);
    expect(dashboard.queue[0]?.kind).toBe("refund");
    expect(dashboard.queue[0]?.id).toBe("refund-refund-0");
    expect(dashboard.queue[0]?.search).toEqual({ order: "refund-0" });
    expect(dashboard.queue[0]?.recordId).toBe("refund-0");
    expect(dashboard.queue.some((item) => item.kind === "confirmation")).toBe(true);
    expect(dashboard.queue.some((item) => item.kind === "verification")).toBe(true);
    expect(dashboard.queue.find((item) => item.kind === "verification")?.detail).toContain(
      "TRAD/DNCC/5678/2024",
    );
    expect(dashboard.queue.find((item) => item.kind === "dispute")?.search).toEqual({
      complaint: "dispute",
    });
    expect(dashboard.queue.every((item) => item.severity !== "neutral")).toBe(true);
    expect(dashboard.summary.pendingVerifications).toBe(1);
    expect(dashboard.summary.refundsAtRisk).toBe(0);
  });

  it("groups queue items by SLA relative to each kind's due time", () => {
    expect(slaBucketFor(iso(2), "refund", now)).toBe("overdue");
    expect(slaBucketFor(iso(0), "refund", now)).toBe("due_soon");
    expect(slaBucketFor(iso(1), "dispute", now)).toBe("due_soon");

    const dashboard = buildAdminDashboard(
      {
        orders: [
          order({
            id: "old-refund",
            manual_refund_status: "pending",
            refund_amount: 150,
            created_at: iso(3),
          }),
        ],
        users: [],
        complaints: [],
      },
      now,
    );

    expect(dashboard.sla.overdue).toBe(1);
    expect(dashboard.sla.refundCount).toBe(1);
    expect(dashboard.sla.refundAmount).toBe(150);
    expect(dashboard.summary.refundsAtRisk).toBe(150);
    expect(dashboard.queue[0]?.sla).toBe("overdue");
  });

  it("returns the newest five orders with units summed from their lines", () => {
    const orders = Array.from({ length: 7 }, (_unused, index) =>
      order({
        id: `order-${index}`,
        created_at: iso(index),
        lines: [
          {
            id: `line-${index}`,
            product_id: "p1",
            product_name: "Rice",
            quantity: index + 1,
            unit_price: 10,
            amount: (index + 1) * 10,
            supplier_id: null,
            supplier_name: null,
            supplier_email: null,
          },
        ],
      }),
    );

    const dashboard = buildAdminDashboard({ orders, users: [], complaints: [] }, now);

    expect(dashboard.recent).toHaveLength(5);
    expect(dashboard.recent[0]?.id).toBe("order-0");
    expect(dashboard.recent[0]?.units).toBe(1);
    expect(dashboard.recent[4]?.id).toBe("order-4");
  });
});

describe("loadAdminDashboard", () => {
  const activity: ActivityResponse = {
    summary: { orders: 1, revenue: 100, retailers: 1, suppliers: 1, units: 1 },
    orders: [order({ id: "order-1" })],
  };
  it("combines activity, accounts, disputes and verifications", async () => {
    const dashboard = await loadAdminDashboard(
      {
        loadActivity: async () => activity,
        loadUsers: async () => [user({ role: null })],
        loadComplaints: async () => [complaint({})],
        loadVerifications: async () => [verification({})],
      },
      now,
    );

    expect(dashboard.failures).toEqual([]);
    expect(dashboard.summary.accountsNeedingSetup).toBe(1);
    expect(dashboard.summary.openDisputes).toBe(1);
    expect(dashboard.summary.pendingVerifications).toBe(1);
    expect(dashboard.pendingVerifications).toHaveLength(1);
  });

  it("degrades the supplemental panels instead of failing the page", async () => {
    const dashboard = await loadAdminDashboard(
      {
        loadActivity: async () => activity,
        loadUsers: async () => [],
        loadComplaints: () => Promise.reject(new Error("Disputes are unavailable.")),
        loadVerifications: () => Promise.reject(new Error("Verifications are unavailable.")),
      },
      now,
    );

    expect(dashboard.summary.orderValue).toBe(100);
    expect(dashboard.failures.map((failure) => failure.section)).toEqual([
      ADMIN_DISPUTES_SECTION,
      ADMIN_VERIFICATIONS_SECTION,
    ]);
  });

  it("still fails when the required order activity fails", async () => {
    await expect(
      loadAdminDashboard(
        {
          loadActivity: () => Promise.reject(new Error("Admin service unavailable.")),
          loadUsers: async () => [],
          loadComplaints: async () => [],
          loadVerifications: async () => [],
        },
        now,
      ),
    ).rejects.toThrow("Admin service unavailable.");
  });
});
