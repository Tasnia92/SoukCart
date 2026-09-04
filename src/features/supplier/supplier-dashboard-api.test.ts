import { describe, expect, it } from "vite-plus/test";
import type { SupplierOrder, SupplierOrderItem } from "./supplier-orders-api.ts";
import type { SupplierProduct } from "./supplier-overview-api.ts";
import {
  buildSupplierDashboard,
  EMPTY_SELLER_EARNINGS,
  loadSupplierDashboard,
  LOW_STOCK_THRESHOLD,
  normalizeSellerEarnings,
  SUPPLIER_QUEUE_LIMIT,
  SUPPLIER_RECENT_LISTING_LIMIT,
} from "./supplier-dashboard-api.ts";

const now = Date.parse("2026-09-02T12:00:00.000Z");
const DAY = 86_400_000;

function iso(offsetDays: number, offsetMs = 0): string {
  return new Date(now - offsetDays * DAY - offsetMs).toISOString();
}

function item(overrides: Partial<SupplierOrderItem>): SupplierOrderItem {
  return {
    id: "item-1",
    product_id: "product-1",
    product_name: "Atlas dates",
    quantity: 2,
    unit_price: 100,
    line_total: 200,
    ...overrides,
  };
}

function order(overrides: Partial<SupplierOrder>): SupplierOrder {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    status: "pending",
    cancel_requested: false,
    cancellation_initiator: null,
    cancellation_reason: null,
    payment_status: "paid",
    payment_method: "online",
    delivery_verified_at: null,
    delivery_phone: "01700000000",
    delivery_address: "12 Road",
    delivery_city: "Dhaka",
    delivery_postcode: "1205",
    manual_refund_status: "not_required",
    supplier_can_cancel: true,
    notes: null,
    created_at: iso(1),
    retailer_name: "Rani Retail",
    retailer_email: "rani@example.com",
    accepted_at: null,
    items: [item({})],
    supplier_total: 200,
    shipment: null,
    ...overrides,
  };
}

function product(overrides: Partial<SupplierProduct>): SupplierProduct {
  return {
    id: "product-1",
    name: "Atlas dates",
    description: "Sweet dates",
    price: 100,
    unit: "kg",
    stock: 20,
    min_order_qty: 1,
    category: "Pantry",
    image_url: null,
    is_active: true,
    created_at: iso(10),
    reorder_threshold: LOW_STOCK_THRESHOLD,
    stock_version: 0,
    ...overrides,
  };
}

describe("buildSupplierDashboard", () => {
  it("reports window sales from the supplier's own share and excludes cancelled orders", () => {
    const dashboard = buildSupplierDashboard(
      [
        order({ id: "recent", supplier_total: 500, created_at: iso(3) }),
        order({ id: "void", supplier_total: 800, created_at: iso(3), status: "cancelled" }),
        order({ id: "previous", supplier_total: 250, created_at: iso(45) }),
      ],
      [],
      now,
    );

    expect(dashboard.summary.sales).toBe(500);
    expect(dashboard.summary.orders).toBe(1);
    expect(dashboard.summary.salesDelta.percent).toBe(100);
    expect(dashboard.series).toHaveLength(30);
    expect(dashboard.series.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(500);
  });

  it("counts pending and confirmed orders as awaiting fulfillment", () => {
    const dashboard = buildSupplierDashboard(
      [
        order({ id: "waiting", status: "pending" }),
        order({ id: "unpaid-online", status: "pending", payment_status: "unpaid" }),
        order({ id: "to-ship", status: "confirmed" }),
        order({ id: "moving", status: "shipped" }),
        order({ id: "requested", status: "confirmed", cancel_requested: true }),
        order({ id: "dead", status: "cancelled", cancel_requested: true }),
      ],
      [],
      now,
    );

    expect(dashboard.summary.awaitingFulfillment).toBe(2);
    expect(dashboard.summary.toConfirm).toBe(1);
    expect(dashboard.summary.toShip).toBe(1);
    expect(dashboard.summary.awaitingPayment).toBe(1);
    expect(dashboard.summary.cancellationRequests).toBe(1);
    expect(dashboard.queue.map((entry) => entry.id)).toEqual(["waiting", "to-ship", "requested"]);
  });

  it("puts the most overdue order first and escalates anything older than a day", () => {
    const dashboard = buildSupplierDashboard(
      [order({ id: "today", created_at: iso(0) }), order({ id: "yesterday", created_at: iso(2) })],
      [],
      now,
    );

    expect(dashboard.queue.map((entry) => entry.id)).toEqual(["yesterday", "today"]);
    expect(dashboard.queue[0]?.severity).toBe("critical");
    expect(dashboard.queue[0]?.ageDays).toBe(2);
    expect(dashboard.queue[1]?.severity).toBe("attention");
  });

  it("caps the queue", () => {
    const orders = Array.from({ length: SUPPLIER_QUEUE_LIMIT + 3 }, (_unused, index) =>
      order({ id: `order-${index}`, created_at: iso(index) }),
    );

    expect(buildSupplierDashboard(orders, [], now).queue).toHaveLength(SUPPLIER_QUEUE_LIMIT);
  });

  it("classifies stock risk across active listings only, worst first", () => {
    const dashboard = buildSupplierDashboard(
      [],
      [
        product({ id: "healthy", stock: LOW_STOCK_THRESHOLD + 1 }),
        product({ id: "low", stock: LOW_STOCK_THRESHOLD }),
        product({ id: "empty", stock: 0 }),
        // Hidden listings are excluded: they are not on sale, so they are not a risk.
        product({ id: "hidden-empty", stock: 0, is_active: false }),
      ],
      now,
    );

    expect(dashboard.summary.activeListings).toBe(3);
    expect(dashboard.summary.totalListings).toBe(4);
    expect(dashboard.summary.outOfStock).toBe(1);
    expect(dashboard.summary.lowStock).toBe(1);
    expect(dashboard.summary.stockAtRisk).toBe(2);
    expect(dashboard.stockRisk.map((entry) => entry.id)).toEqual(["empty", "low"]);
    expect(dashboard.stockRisk[0]?.severity).toBe("critical");
    expect(dashboard.stockRisk[1]?.severity).toBe("attention");
    expect(dashboard.stockHealth.total).toBe(3);
    expect(dashboard.stockHealth.segments.map((segment) => segment.count)).toEqual([1, 1, 1]);
  });

  it("ranks top products by value within the window", () => {
    const dashboard = buildSupplierDashboard(
      [
        order({
          id: "a",
          created_at: iso(2),
          items: [
            item({
              id: "i1",
              product_id: "dates",
              product_name: "Dates",
              quantity: 1,
              line_total: 100,
            }),
            item({
              id: "i2",
              product_id: "oil",
              product_name: "Oil",
              quantity: 5,
              line_total: 400,
            }),
          ],
        }),
        order({
          id: "b",
          created_at: iso(4),
          items: [
            item({
              id: "i3",
              product_id: "dates",
              product_name: "Dates",
              quantity: 3,
              line_total: 300,
            }),
          ],
        }),
        // Out of window, and cancelled — neither should reach the ranking.
        order({
          id: "old",
          created_at: iso(90),
          items: [item({ id: "i4", product_id: "tea", product_name: "Tea", line_total: 9000 })],
        }),
        order({
          id: "void",
          status: "cancelled",
          items: [item({ id: "i5", product_id: "mint", product_name: "Mint", line_total: 9000 })],
        }),
      ],
      [],
      now,
    );

    expect(dashboard.topProducts).toEqual([
      { id: "oil", name: "Oil", units: 5, value: 400 },
      { id: "dates", name: "Dates", units: 4, value: 400 },
    ]);
  });

  it("keeps only the newest few listings as a secondary widget", () => {
    const products = Array.from({ length: SUPPLIER_RECENT_LISTING_LIMIT + 2 }, (_unused, index) =>
      product({ id: `product-${index}`, created_at: iso(index) }),
    );

    const dashboard = buildSupplierDashboard([], products, now);

    expect(dashboard.recentListings).toHaveLength(SUPPLIER_RECENT_LISTING_LIMIT);
    expect(dashboard.recentListings[0]?.id).toBe("product-0");
  });
});

describe("loadSupplierDashboard", () => {
  it("loads orders and products together for one seller", async () => {
    const requested: string[] = [];

    const dashboard = await loadSupplierDashboard(
      "seller-1",
      {
        loadOrders: async () => [order({ supplier_total: 300, created_at: iso(1) })],
        loadProducts: async (sellerId) => {
          requested.push(sellerId);
          return [product({ stock: 0 })];
        },
      },
      now,
    );

    expect(requested).toEqual(["seller-1"]);
    expect(dashboard.summary.sales).toBe(300);
    expect(dashboard.summary.outOfStock).toBe(1);
  });
});

describe("normalizeSellerEarnings", () => {
  it("defaults to empty totals and an empty ledger", () => {
    expect(normalizeSellerEarnings(null)).toEqual(EMPTY_SELLER_EARNINGS);
    expect(normalizeSellerEarnings({ commissionRate: "0.05" }).rows).toEqual([]);
  });

  it("keeps valid ledger rows and drops malformed ones", () => {
    const parsed = normalizeSellerEarnings({
      commissionRate: 0.05,
      available: 120,
      paid: 80,
      commission: 10,
      rows: [
        {
          id: "payout-1",
          orderId: "00000000-0000-0000-0000-000000000099",
          gross: 200,
          commissionRate: 0.05,
          commissionAmount: 10,
          netPayable: 190,
          status: "available",
          accruedAt: "2026-09-01T10:00:00.000Z",
          paidAt: null,
        },
        {
          id: "payout-2",
          orderId: "00000000-0000-0000-0000-000000000088",
          gross: 100,
          commissionRate: 0.05,
          commissionAmount: 5,
          netPayable: 95,
          status: "paid",
          accruedAt: "2026-08-20T10:00:00.000Z",
          paidAt: "2026-08-25T12:00:00.000Z",
        },
        { id: "bad", gross: 50 },
        "skip-me",
      ],
    });

    expect(parsed.commissionRate).toBe(0.05);
    expect(parsed.available).toBe(120);
    expect(parsed.paid).toBe(80);
    expect(parsed.commission).toBe(10);
    expect(parsed.rows).toEqual([
      {
        id: "payout-1",
        orderId: "00000000-0000-0000-0000-000000000099",
        gross: 200,
        commissionRate: 0.05,
        commissionAmount: 10,
        netPayable: 190,
        status: "available",
        accruedAt: "2026-09-01T10:00:00.000Z",
        paidAt: null,
      },
      {
        id: "payout-2",
        orderId: "00000000-0000-0000-0000-000000000088",
        gross: 100,
        commissionRate: 0.05,
        commissionAmount: 5,
        netPayable: 95,
        status: "paid",
        accruedAt: "2026-08-20T10:00:00.000Z",
        paidAt: "2026-08-25T12:00:00.000Z",
      },
    ]);
  });

  it("normalizes unknown status values to available", () => {
    const parsed = normalizeSellerEarnings({
      rows: [
        {
          id: "payout-3",
          orderId: "order-3",
          status: "mystery",
          accruedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });

    expect(parsed.rows[0]?.status).toBe("available");
  });
});
