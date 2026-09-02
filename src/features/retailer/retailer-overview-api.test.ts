import { describe, expect, it } from "vite-plus/test";
import type { RetailerOrder } from "./retailer-orders-api.ts";
import {
  applyReconciliation,
  loadRetailerOverview,
  reconcileRetailerPayments,
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

function deps(overrides: {
  orders?: RetailerOrder[];
  cartCount?: number;
  queryResults?: Record<string, "paid" | "failed" | "cancelled" | "pending">;
}): { deps: RetailerOverviewDeps; queried: string[]; cleared: string[] } {
  const queried: string[] = [];
  const cleared: string[] = [];
  return {
    queried,
    cleared,
    deps: {
      loadOrders: async () => overrides.orders ?? [],
      loadCart: async () => overrides.cartCount ?? 0,
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
  it("loads orders and cart without touching the payment gateway", async () => {
    const fake = deps({
      orders: [order({ id: "o1", payment_status: "unpaid", tran_id: "t1" })],
      cartCount: 4,
    });

    const result = await loadRetailerOverview("retailer-1", fake.deps);

    expect(result.cartCount).toBe(4);
    expect(result.orders).toHaveLength(1);
    // The gateway must stay off the critical render path.
    expect(fake.queried).toEqual([]);
    expect(fake.cleared).toEqual([]);
  });

  it("reconciles every unpaid online order sequentially and clears the cart once paid", async () => {
    const orders = [
      order({ id: "o1", payment_status: "unpaid", tran_id: "t1" }),
      order({ id: "o2", payment_status: "paid", tran_id: "t2" }),
      order({ id: "o3", payment_status: "unpaid", tran_id: "t3" }),
    ];
    const fake = deps({ queryResults: { t1: "pending", t3: "paid" } });

    const result = await reconcileRetailerPayments("retailer-1", orders, fake.deps);

    expect(fake.queried).toEqual(["t1", "t3"]);
    expect(fake.cleared).toEqual(["retailer-1"]);
    expect(result.cartCleared).toBe(true);
    expect(result.updates).toEqual([{ id: "o3", payment_status: "paid" }]);
    // Reconciliation reports changes instead of mutating what is already rendered.
    expect(orders.map((entry) => entry.payment_status)).toEqual(["unpaid", "paid", "unpaid"]);
  });

  it("reports failed and cancelled statuses without clearing the cart", async () => {
    const orders = [
      order({ id: "o1", payment_status: "unpaid", tran_id: "t1" }),
      order({ id: "o2", payment_status: "unpaid", tran_id: "t2" }),
    ];
    const fake = deps({ queryResults: { t1: "failed", t2: "cancelled" } });

    const result = await reconcileRetailerPayments("retailer-1", orders, fake.deps);

    expect(fake.cleared).toEqual([]);
    expect(result.cartCleared).toBe(false);
    expect(result.updates).toEqual([
      { id: "o1", payment_status: "failed" },
      { id: "o2", payment_status: "cancelled" },
    ]);
  });

  it("skips orders without a transaction reference", async () => {
    const fake = deps({});

    const result = await reconcileRetailerPayments(
      "retailer-1",
      [order({ id: "o1", payment_status: "unpaid", tran_id: null })],
      fake.deps,
    );

    expect(fake.queried).toEqual([]);
    expect(result.updates).toEqual([]);
  });

  it("applies updates onto a fresh order list", () => {
    const orders = [order({ id: "o1" }), order({ id: "o2" })];

    const applied = applyReconciliation(orders, [{ id: "o2", payment_status: "paid" }]);

    expect(applied.map((entry) => entry.payment_status)).toEqual(["unpaid", "paid"]);
    expect(applied[0]).toBe(orders[0]);
    expect(applied[1]).not.toBe(orders[1]);
    expect(applyReconciliation(orders, [])).toEqual(orders);
  });
});
