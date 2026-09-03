import { describe, expect, it } from "vite-plus/test";
import type { RetailerComplaint } from "./retailer-complaints-api.ts";
import type { RetailerOrder, RetailerOrderItem } from "./retailer-orders-api.ts";
import {
  buildRetailerDashboard,
  loadRetailerDashboardInput,
  pickNextAction,
  RETAILER_HELP_SECTION,
  RETAILER_RECENT_LIMIT,
} from "./retailer-dashboard-api.ts";

const now = Date.parse("2026-09-02T12:00:00.000Z");
const DAY = 86_400_000;

function iso(offsetDays: number, offsetMs = 0): string {
  return new Date(now - offsetDays * DAY - offsetMs).toISOString();
}

function item(overrides: Partial<RetailerOrderItem> = {}): RetailerOrderItem {
  return {
    id: "item-1",
    product_id: "product-1",
    quantity: 2,
    unit_price: 50,
    product_name: "Atlas dates",
    ...overrides,
  };
}

function order(overrides: Partial<RetailerOrder>): RetailerOrder {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    status: "pending",
    cancel_requested: false,
    cancellation_initiator: null,
    payment_status: "paid",
    payment_method: "online",
    tran_id: null,
    notes: null,
    created_at: iso(1),
    delivery_verified_at: null,
    delivery_phone: "01700000000",
    delivery_address: "12 Road",
    delivery_city: "Dhaka",
    delivery_postcode: "1205",
    manual_refund_status: "not_required",
    refund_amount: 0,
    platform_charge: 0,
    delivery_charge: 0,
    items: [item()],
    ...overrides,
  };
}

function complaint(overrides: Partial<RetailerComplaint>): RetailerComplaint {
  return {
    id: "complaint-1",
    order_id: null,
    category: "general",
    subject: "Wrong item",
    description: "Received the wrong unit",
    attachment_url: null,
    status: "open",
    created_at: iso(3),
    ...overrides,
  };
}

describe("pickNextAction", () => {
  it("puts an open cart ahead of everything else", () => {
    const action = pickNextAction([order({ payment_status: "failed" })], 3, now);

    expect(action.kind).toBe("checkout");
    expect(action.title).toContain("3 items");
    expect(action.to).toBe("/retailer/cart");
  });

  it("uses the singular form for one cart item", () => {
    expect(pickNextAction([], 1, now).title).toContain("1 item");
  });

  it("raises a broken payment above a delivery to confirm", () => {
    const action = pickNextAction(
      [
        order({ id: "unconfirmed", status: "delivered", delivery_verified_at: null }),
        order({ id: "broken", payment_status: "failed", created_at: iso(2) }),
      ],
      0,
      now,
    );

    expect(action.kind).toBe("retry-payment");
    expect(action.severity).toBe("critical");
    expect(action.orderId).toBe("broken");
  });

  it("ignores a failed payment on an already cancelled order", () => {
    const action = pickNextAction(
      [order({ id: "dead", status: "cancelled", payment_status: "failed" })],
      0,
      now,
    );

    expect(action.kind).toBe("browse");
  });

  it("asks for delivery confirmation before offering tracking", () => {
    const action = pickNextAction(
      [
        order({ id: "moving", status: "shipped" }),
        order({ id: "arrived", status: "delivered", delivery_verified_at: null }),
      ],
      0,
      now,
    );

    expect(action.kind).toBe("confirm-delivery");
    expect(action.orderId).toBe("arrived");
  });

  it("tracks the oldest still-moving order, because it lands first", () => {
    const action = pickNextAction(
      [
        order({ id: "new", status: "confirmed", created_at: iso(1) }),
        order({ id: "oldest", status: "shipped", created_at: iso(6) }),
        order({ id: "done", status: "delivered", delivery_verified_at: iso(0) }),
      ],
      0,
      now,
    );

    expect(action.kind).toBe("track");
    expect(action.orderId).toBe("oldest");
    expect(action.copy).toContain("6 days ago");
    expect(action.copy).toContain("shipped");
  });

  it("falls back to browsing when nothing needs attention", () => {
    const action = pickNextAction(
      [order({ status: "delivered", delivery_verified_at: iso(0) })],
      0,
      now,
    );

    expect(action.kind).toBe("browse");
    expect(action.to).toBe("/retailer/catalog");
  });
});

describe("buildRetailerDashboard", () => {
  it("sums spend from order lines and excludes cancelled orders", () => {
    const dashboard = buildRetailerDashboard(
      {
        orders: [
          order({
            id: "recent",
            created_at: iso(2),
            items: [item({ quantity: 3, unit_price: 100 })],
          }),
          order({ id: "void", created_at: iso(2), status: "cancelled" }),
          order({
            id: "previous",
            created_at: iso(40),
            items: [item({ quantity: 1, unit_price: 150 })],
          }),
        ],
        cartUnits: 0,
        complaints: [],
      },
      now,
    );

    expect(dashboard.summary.spend).toBe(300);
    expect(dashboard.summary.orders).toBe(1);
    expect(dashboard.summary.spendDelta.percent).toBe(100);
    expect(dashboard.series).toHaveLength(30);
  });

  it("separates orders still in flight from deliveries inside the window", () => {
    const dashboard = buildRetailerDashboard(
      {
        orders: [
          order({ id: "pending", status: "pending" }),
          order({ id: "confirmed", status: "confirmed" }),
          order({ id: "shipped", status: "shipped" }),
          order({ id: "delivered", status: "delivered", created_at: iso(3) }),
          order({ id: "old-delivery", status: "delivered", created_at: iso(60) }),
          order({ id: "cancelled", status: "cancelled" }),
        ],
        cartUnits: 7,
        complaints: [],
      },
      now,
    );

    expect(dashboard.summary.activeOrders).toBe(3);
    expect(dashboard.summary.delivered).toBe(1);
    expect(dashboard.summary.cartUnits).toBe(7);
    expect(dashboard.stages.map((stage) => stage.count)).toEqual([1, 1, 1, 2, 1]);
  });

  it("flags recent rows that still need a delivery confirmation", () => {
    const dashboard = buildRetailerDashboard(
      {
        orders: [
          order({ id: "arrived", status: "delivered", delivery_verified_at: null }),
          order({
            id: "closed",
            status: "delivered",
            delivery_verified_at: iso(0),
            created_at: iso(2),
          }),
        ],
        cartUnits: 0,
        complaints: [],
      },
      now,
    );

    expect(dashboard.recent[0]?.needsDeliveryConfirmation).toBe(true);
    expect(dashboard.recent[1]?.needsDeliveryConfirmation).toBe(false);
    expect(dashboard.recent[0]?.units).toBe(2);
    expect(dashboard.recent[0]?.total).toBe(100);
  });

  it("caps the recent list at the newest few", () => {
    const orders = Array.from({ length: RETAILER_RECENT_LIMIT + 3 }, (_unused, index) =>
      order({ id: `order-${index}`, created_at: iso(index) }),
    );

    const dashboard = buildRetailerDashboard({ orders, cartUnits: 0, complaints: [] }, now);

    expect(dashboard.recent).toHaveLength(RETAILER_RECENT_LIMIT);
    expect(dashboard.recent[0]?.id).toBe("order-0");
  });

  it("splits help tickets into open and resolved", () => {
    const dashboard = buildRetailerDashboard(
      {
        orders: [],
        cartUnits: 0,
        complaints: [
          complaint({ id: "a" }),
          complaint({ id: "b", status: "resolved" }),
          complaint({ id: "c", status: "resolved" }),
        ],
      },
      now,
    );

    expect(dashboard.help).toEqual({ open: 1, resolved: 2, total: 3 });
  });
});

describe("loadRetailerDashboardInput", () => {
  it("returns the raw orders alongside the aggregate input", async () => {
    const input = await loadRetailerDashboardInput("retailer-1", {
      loadOverview: async () => ({ orders: [order({ id: "o1" })], cartCount: 2 }),
      loadTickets: async () => [complaint({})],
    });

    expect(input.orders).toHaveLength(1);
    expect(input.cartUnits).toBe(2);
    expect(input.complaints).toHaveLength(1);
    expect(input.failures).toEqual([]);
  });

  it("degrades the Help Center widget instead of failing the page", async () => {
    const input = await loadRetailerDashboardInput("retailer-1", {
      loadOverview: async () => ({ orders: [], cartCount: 0 }),
      loadTickets: () => Promise.reject(new Error("Tickets are unavailable.")),
    });

    expect(input.complaints).toEqual([]);
    expect(input.failures).toEqual([
      { section: RETAILER_HELP_SECTION, message: "Tickets are unavailable." },
    ]);
  });

  it("still fails when orders fail", async () => {
    await expect(
      loadRetailerDashboardInput("retailer-1", {
        loadOverview: () => Promise.reject(new Error("Orders are unavailable.")),
        loadTickets: async () => [],
      }),
    ).rejects.toThrow("Orders are unavailable.");
  });
});
