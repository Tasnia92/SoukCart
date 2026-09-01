import { describe, expect, it } from "vite-plus/test";
import type { RetailerOrder } from "./retailer-orders-api.ts";
import {
  getRetailerOverviewStats,
  loadRetailerOverview,
  type RetailerOverviewDeps,
} from "./retailer-overview-api.ts";

function order(overrides: Partial<RetailerOrder>): RetailerOrder {
  return {
    id: "o1",
    status: "pending",
    cancel_requested: false,
    cancellation_initiator: null,
    payment_status: "unpaid",
    payment_method: "online",
    tran_id: null,
    notes: null,
    created_at: "2026-08-30T12:00:00.000Z",
    delivery_verified_at: null,
    manual_refund_status: "not_required",
    refund_amount: 0,
    platform_charge: 0,
    delivery_charge: 0,
    items: [],
    ...overrides,
  };
}

function deps(
  overrides: Partial<RetailerOverviewDeps> & {
    orders: RetailerOrder[];
    cartCount: number;
    queryResults?: Record<string, "paid" | "failed" | "cancelled" | "pending">;
  },
): { deps: RetailerOverviewDeps; queried: string[]; cleared: string[] } {
  const queried: string[] = [];
  const cleared: string[] = [];
  return {
    queried,
    cleared,
    deps: {
      loadOrders: async () => overrides.orders,
      loadCart: async () => overrides.cartCount,
      queryPayment: async (tranId: string) => {
        queried.push(tranId);
        return overrides.queryResults?.[tranId] ?? "pending";
      },
      clearRetailerCart: async (userId: string) => {
        cleared.push(userId);
      },
    },
  };
}

describe("retailer overview API", () => {
  it("reconciles every unpaid online order sequentially and clears the cart once paid", async () => {
    const orders = [
      order({ id: "o1", payment_status: "unpaid", tran_id: "t1" }),
      order({ id: "o2", payment_status: "paid", tran_id: "t2" }),
      order({ id: "o3", payment_status: "unpaid", tran_id: "t3" }),
    ];
    const fake = deps({
      orders,
      cartCount: 4,
      queryResults: { t1: "pending", t3: "paid" },
    });

    const result = await loadRetailerOverview("retailer-1", fake.deps);

    expect(fake.queried).toEqual(["t1", "t3"]);
    expect(fake.cleared).toEqual(["retailer-1"]);
    expect(result.cartCount).toBe(0);
    expect(result.orders.find((o) => o.id === "o3")?.payment_status).toBe("paid");
  });

  it("updates failed and cancelled statuses without clearing the cart", async () => {
    const orders = [
      order({ id: "o1", payment_status: "unpaid", tran_id: "t1" }),
      order({ id: "o2", payment_status: "unpaid", tran_id: "t2" }),
    ];
    const fake = deps({
      orders,
      cartCount: 3,
      queryResults: { t1: "failed", t2: "cancelled" },
    });

    const result = await loadRetailerOverview("retailer-1", fake.deps);

    expect(fake.cleared).toEqual([]);
    expect(result.cartCount).toBe(3);
    expect(result.orders.map((o) => o.payment_status)).toEqual(["failed", "cancelled"]);
  });

  it("skips orders without a transaction reference", async () => {
    const fake = deps({
      orders: [order({ id: "o1", payment_status: "unpaid", tran_id: null })],
      cartCount: 2,
    });

    const result = await loadRetailerOverview("retailer-1", fake.deps);

    expect(fake.queried).toEqual([]);
    expect(result.cartCount).toBe(2);
  });

  it("derives overview stats", () => {
    const stats = getRetailerOverviewStats(
      [
        order({ status: "pending" }),
        order({ status: "delivered" }),
        order({ status: "delivered" }),
        order({ status: "shipped" }),
      ],
      7,
    );

    expect(stats).toEqual({ orders: 4, pending: 1, delivered: 2, inCart: 7 });
  });
});
