import { describe, expect, it } from "vite-plus/test";
import type { OrderNotification } from "../notifications/notifications-api.ts";
import type { ActivityOrder, ActivityResponse } from "./admin-activity-api.ts";
import type { AdminComplaint } from "./admin-complaints-api.ts";
import type { AdminOverviewUser } from "./admin-overview-api.ts";
import {
  ADMIN_DISPUTES_SECTION,
  ADMIN_NOTIFICATIONS_SECTION,
  ADMIN_QUEUE_LIMIT,
  buildAdminDashboard,
  loadAdminDashboard,
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

describe("buildAdminDashboard", () => {
  it("reports revenue for the window and excludes cancelled orders", () => {
    const dashboard = buildAdminDashboard(
      {
        orders: [
          order({ id: "in-window", total: 400, created_at: iso(5) }),
          order({ id: "cancelled", total: 900, created_at: iso(5), status: "cancelled" }),
          order({ id: "previous", total: 200, created_at: iso(40) }),
          order({ id: "ancient", total: 5000, created_at: iso(120) }),
        ],
        users: [],
        complaints: [],
        notifications: [],
      },
      now,
    );

    expect(dashboard.summary.revenue).toBe(400);
    expect(dashboard.summary.orders).toBe(1);
    // 400 against the previous window's 200.
    expect(dashboard.summary.revenueDelta.percent).toBe(100);
    expect(dashboard.series).toHaveLength(30);
    expect(dashboard.series.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(400);
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
        notifications: [],
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
        notifications: [],
      },
      now,
    );

    expect(dashboard.summary.accounts).toBe(5);
    expect(dashboard.summary.activeAccounts).toBe(1);
    expect(dashboard.summary.newAccounts).toBe(1);
    expect(dashboard.summary.accountsNeedingSetup).toBe(2);
  });

  it("orders the queue by cost of delay and caps it", () => {
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
        ],
        users: [],
        complaints: [complaint({ id: "dispute" })],
        notifications: [],
      },
      now,
    );

    expect(dashboard.queue).toHaveLength(ADMIN_QUEUE_LIMIT);
    expect(dashboard.queue.slice(0, 5).every((item) => item.kind === "refund")).toBe(true);
    expect(dashboard.queue[5]?.kind).toBe("cancellation");
    // Newest first inside a group.
    expect(dashboard.queue[0]?.id).toBe("refund-refund-0");
    expect(dashboard.queue.every((item) => item.severity !== "neutral")).toBe(true);
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

    const dashboard = buildAdminDashboard(
      { orders, users: [], complaints: [], notifications: [] },
      now,
    );

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
  const notification: OrderNotification = {
    id: "n1",
    order_id: null,
    type: "order",
    title: "Order placed",
    message: "A retailer placed an order.",
    created_at: iso(0),
    read_at: null,
  };

  it("combines activity, accounts, disputes and notifications", async () => {
    const dashboard = await loadAdminDashboard(
      {
        loadActivity: async () => activity,
        loadUsers: async () => [user({ role: null })],
        loadComplaints: async () => [complaint({})],
        loadFeed: async () => [notification],
      },
      now,
    );

    expect(dashboard.failures).toEqual([]);
    expect(dashboard.summary.accountsNeedingSetup).toBe(1);
    expect(dashboard.summary.openDisputes).toBe(1);
    expect(dashboard.notifications).toHaveLength(1);
  });

  it("degrades the supplemental panels instead of failing the page", async () => {
    const dashboard = await loadAdminDashboard(
      {
        loadActivity: async () => activity,
        loadUsers: async () => [],
        loadComplaints: () => Promise.reject(new Error("Disputes are unavailable.")),
        loadFeed: () => Promise.reject(new Error("Notifications are unavailable.")),
      },
      now,
    );

    expect(dashboard.summary.revenue).toBe(100);
    expect(dashboard.failures.map((failure) => failure.section)).toEqual([
      ADMIN_DISPUTES_SECTION,
      ADMIN_NOTIFICATIONS_SECTION,
    ]);
  });

  it("still fails when the required order activity fails", async () => {
    await expect(
      loadAdminDashboard(
        {
          loadActivity: () => Promise.reject(new Error("Admin service unavailable.")),
          loadUsers: async () => [],
          loadComplaints: async () => [],
          loadFeed: async () => [],
        },
        now,
      ),
    ).rejects.toThrow("Admin service unavailable.");
  });
});
