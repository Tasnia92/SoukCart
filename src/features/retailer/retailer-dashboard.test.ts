import { describe, expect, it } from "vite-plus/test";
import type { RetailerOrder, RetailerShipment } from "./retailer-orders-api.ts";
import {
  buildRetailerDashboard,
  needsDeliveryConfirmation,
  pickNextAction,
  hasFailedPayment,
} from "./retailer-dashboard-api.ts";
import {
  deliveryAgeDays,
  filterOrdersByQuery,
  packageStatusLabel,
  parseOrderSort,
  primaryShipment,
  shipmentStatusLabel,
  sortOrders,
} from "./retailer-orders-api.ts";
import { reorderPlan, type ReorderItem } from "./retailer-cart-api.ts";
import { parseProductSort, sortProducts, type RetailerProduct } from "./retailer-catalog-api.ts";

const NOW = Date.parse("2026-09-05T12:00:00Z");

let sequence = 0;

function order(overrides: Partial<RetailerOrder> = {}): RetailerOrder {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${`${sequence}`.padStart(12, "0")}`,
    status: "pending",
    cancel_requested: false,
    cancellation_initiator: null,
    payment_status: "paid",
    payment_method: "online",
    tran_id: "TXN1",
    notes: null,
    created_at: "2026-09-01T09:00:00Z",
    delivery_verified_at: null,
    delivery_phone: null,
    delivery_address: null,
    delivery_city: null,
    delivery_postcode: null,
    delivery_payment_status: "unpaid",
    delivery_paid_at: null,
    manual_refund_status: "not_required",
    refund_amount: 0,
    platform_charge: 0,
    delivery_charge: 60,
    items: [],
    packages: [],
    shipments: [],
    ...overrides,
  };
}

function shipment(status: string, shippedAt: string): RetailerShipment {
  sequence += 1;
  return {
    id: `shipment-${sequence}`,
    seller_id: null,
    carrier: "BD Post",
    tracking_number: `TRK${`${sequence}`.padStart(6, "0")}`,
    tracking_url: "",
    status,
    notes: "",
    shipped_at: shippedAt,
    events: [],
  };
}

function product(overrides: Partial<RetailerProduct> = {}): RetailerProduct {
  sequence += 1;
  return {
    id: `product-${sequence}`,
    name: `Product ${sequence}`,
    description: "",
    price: 10,
    unit: "kg",
    stock: 20,
    min_order_qty: 1,
    category: null,
    image_url: null,
    seller_id: null,
    seller_name: null,
    ...overrides,
  };
}

describe("primaryShipment", () => {
  it("returns null when the order has no shipments", () => {
    expect(primaryShipment(order())).toBeNull();
  });

  it("prefers carrier exceptions over everything", () => {
    const subject = order({
      shipments: [
        shipment("delivered", "2026-09-02T00:00:00Z"),
        shipment("exception", "2026-09-01T00:00:00Z"),
      ],
    });
    expect(primaryShipment(subject)?.status).toBe("exception");
  });

  it("prefers the parcel closest to the door", () => {
    const subject = order({
      shipments: [
        shipment("shipped", "2026-09-03T00:00:00Z"),
        shipment("out_for_delivery", "2026-09-01T00:00:00Z"),
      ],
    });
    expect(primaryShipment(subject)?.status).toBe("out_for_delivery");
  });

  it("breaks ties with the newest handoff", () => {
    const subject = order({
      shipments: [
        shipment("in_transit", "2026-09-01T00:00:00Z"),
        shipment("in_transit", "2026-09-03T00:00:00Z"),
      ],
    });
    expect(primaryShipment(subject)?.shipped_at).toBe("2026-09-03T00:00:00Z");
  });
});

describe("labels and age", () => {
  it("maps carrier statuses to plain wording", () => {
    expect(shipmentStatusLabel("in_transit")).toBe("In transit");
    expect(shipmentStatusLabel("out_for_delivery")).toBe("Out for delivery");
    expect(shipmentStatusLabel("exception")).toBe("Delivery exception");
  });

  it("maps package statuses to plain wording", () => {
    expect(packageStatusLabel("pending")).toBe("Waiting on supplier");
    expect(packageStatusLabel("declined")).toBe("Cancelled by supplier");
  });

  it("floors order age at whole days", () => {
    expect(deliveryAgeDays(order({ created_at: "2026-09-05T11:30:00Z" }), NOW)).toBe(0);
    expect(deliveryAgeDays(order({ created_at: "2026-09-04T11:00:00Z" }), NOW)).toBe(1);
    expect(deliveryAgeDays(order({ created_at: "2026-09-02T11:00:00Z" }), NOW)).toBe(3);
  });
});

describe("reorderPlan", () => {
  it("clamps to current stock and respects the minimum order quantity", () => {
    const catalog = [
      product({ id: "p1", stock: 5, min_order_qty: 1 }),
      product({ id: "p2", stock: 40, min_order_qty: 4 }),
    ];
    const items: ReorderItem[] = [
      { product_id: "p1", quantity: 12 },
      { product_id: "p2", quantity: 2 },
    ];
    const plan = reorderPlan(items, catalog);
    expect(plan).toEqual([
      expect.objectContaining({ product: expect.objectContaining({ id: "p1" }), quantity: 5 }),
      expect.objectContaining({ product: expect.objectContaining({ id: "p2" }), quantity: 4 }),
    ]);
  });

  it("drops products that are gone or out of stock", () => {
    const catalog = [product({ id: "p1", stock: 0 })];
    const plan = reorderPlan(
      [
        { product_id: "p1", quantity: 3 },
        { product_id: "missing", quantity: 2 },
      ],
      catalog,
    );
    expect(plan).toEqual([]);
  });
});

describe("pickNextAction", () => {
  it("escalates a broken payment over an unconfirmed delivery", () => {
    const subject = order({ status: "delivered", payment_status: "failed" });
    const action = pickNextAction([subject]);
    expect(action.kind).toBe("retry-payment");
  });

  it("asks for delivery confirmation on delivered-but-unverified orders", () => {
    const action = pickNextAction([order({ status: "delivered" })]);
    expect(action.kind).toBe("confirm-delivery");
  });

  it("falls back to browsing when nothing needs attention", () => {
    const action = pickNextAction([order({ status: "shipped" })]);
    expect(action.kind).toBe("browse");
  });
});

describe("buildRetailerDashboard", () => {
  it("leads the shipments strip with the oldest active order", () => {
    const dashboard = buildRetailerDashboard(
      {
        orders: [
          order({
            id: "11111111-1111-4111-8111-111111111111",
            status: "shipped",
            created_at: "2026-09-03T00:00:00Z",
            packages: [
              { supplier_id: "s1", status: "shipped", decline_reason: null },
              { supplier_id: "s2", status: "confirmed", decline_reason: null },
            ],
            shipments: [shipment("in_transit", "2026-09-03T06:00:00Z")],
          }),
          order({
            id: "22222222-2222-4222-8222-222222222222",
            status: "pending",
            created_at: "2026-09-04T00:00:00Z",
          }),
        ],
        cartItems: 0,
      },
      NOW,
    );

    expect(dashboard.shipments.map((card) => card.orderId)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(dashboard.shipments[0]).toEqual(
      expect.objectContaining({ packageCount: 2, status: "shipped" }),
    );
    expect(dashboard.shipments[0]?.shipment).toEqual(
      expect.objectContaining({ carrier: "BD Post", status: "in_transit" }),
    );
    expect(dashboard.shipments[1]?.shipment).toBeNull();
  });

  it("targets the newest delivered order for one-click reorder", () => {
    const dashboard = buildRetailerDashboard(
      {
        orders: [
          order({ status: "delivered", created_at: "2026-08-20T00:00:00Z" }),
          order({
            id: "33333333-3333-4333-8333-333333333333",
            status: "delivered",
            created_at: "2026-09-01T00:00:00Z",
          }),
        ],
        cartItems: 0,
      },
      NOW,
    );
    expect(dashboard.reorderOrderId).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("keeps an open basket out of the next-action slot", () => {
    const dashboard = buildRetailerDashboard({ orders: [], cartItems: 3 }, NOW);
    expect(dashboard.nextAction.kind).toBe("browse");
  });

  it("summarises the window without counting cancelled orders as spend", () => {
    const dashboard = buildRetailerDashboard(
      {
        orders: [
          order({ status: "delivered", created_at: "2026-09-02T00:00:00Z" }),
          order({ status: "cancelled", created_at: "2026-09-02T00:00:00Z" }),
        ],
        cartItems: 2,
      },
      NOW,
    );
    expect(dashboard.summary).toEqual(
      expect.objectContaining({ delivered: 1, orders: 1, activeOrders: 0, cartItems: 2 }),
    );
  });
});

describe("order gates", () => {
  it("flags delivered-but-unverified orders for confirmation", () => {
    expect(needsDeliveryConfirmation(order({ status: "delivered" }))).toBe(true);
    expect(
      needsDeliveryConfirmation(
        order({ status: "delivered", delivery_verified_at: "2026-09-05T00:00:00Z" }),
      ),
    ).toBe(false);
    expect(needsDeliveryConfirmation(order({ status: "shipped" }))).toBe(false);
  });

  it("ignores cancelled orders in the failed-payment check", () => {
    expect(hasFailedPayment(order({ payment_status: "failed" }))).toBe(true);
    expect(hasFailedPayment(order({ status: "cancelled", payment_status: "failed" }))).toBe(false);
  });
});

describe("storefront sorting", () => {
  const catalog = [
    product({ id: "b", name: "Banana", price: 30 }),
    product({ id: "a", name: "Apple", price: 20 }),
    product({ id: "c", name: "Cherry", price: 10 }),
  ];

  it("defaults to name order and parses unknown values to the default", () => {
    expect(sortProducts(catalog, "name").map((item) => item.name)).toEqual([
      "Apple",
      "Banana",
      "Cherry",
    ]);
    expect(parseProductSort("price-asc")).toBe("price-asc");
    expect(parseProductSort("nonsense")).toBe("name");
    expect(parseProductSort(null)).toBe("name");
  });

  it("sorts by price without mutating the input", () => {
    const ascending = sortProducts(catalog, "price-asc");
    expect(ascending.map((item) => item.price)).toEqual([10, 20, 30]);
    expect(sortProducts(catalog, "price-desc").map((item) => item.price)).toEqual([30, 20, 10]);
    expect(catalog.map((item) => item.price)).toEqual([30, 20, 10]);
  });
});

describe("order search and sort", () => {
  const list = [
    order({
      id: "31ba5db7-dd50-4434-b796-eef28b7ef46c",
      created_at: "2026-09-01T09:00:00Z",
      delivery_charge: 60,
      items: [
        {
          id: "i1",
          product_id: "p1",
          quantity: 2,
          unit_price: 50,
          product_name: "Rice 25kg",
          seller_id: null,
        },
      ],
    }),
    order({
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      created_at: "2026-09-03T09:00:00Z",
      delivery_charge: 120,
      delivery_city: "Chattogram",
      items: [
        {
          id: "i2",
          product_id: "p2",
          quantity: 1,
          unit_price: 40,
          product_name: "Sugar 1kg",
          seller_id: null,
        },
      ],
    }),
    order({
      id: "bbbbbbbb-0000-4000-8000-000000000002",
      created_at: "2026-09-05T08:00:00Z",
      delivery_charge: 60,
      notes: "Call before delivery",
      items: [
        {
          id: "i3",
          product_id: "p3",
          quantity: 3,
          unit_price: 20,
          product_name: "Lentils 5kg",
          seller_id: null,
        },
      ],
    }),
  ];

  it("parses unknown sort values to the default", () => {
    expect(parseOrderSort("oldest")).toBe("oldest");
    expect(parseOrderSort("total-desc")).toBe("total-desc");
    expect(parseOrderSort("nonsense")).toBe("newest");
    expect(parseOrderSort(null)).toBe("newest");
  });

  it("sorts without mutating the input", () => {
    expect(sortOrders(list, "newest").map((item) => item.id.slice(0, 8))).toEqual([
      "bbbbbbbb",
      "aaaaaaaa",
      "31ba5db7",
    ]);
    expect(sortOrders(list, "oldest").map((item) => item.id.slice(0, 8))).toEqual([
      "31ba5db7",
      "aaaaaaaa",
      "bbbbbbbb",
    ]);
    expect(sortOrders(list, "total-desc").map((item) => item.id.slice(0, 8))).toEqual([
      "aaaaaaaa",
      "31ba5db7",
      "bbbbbbbb",
    ]);
    expect(list.map((item) => item.id.slice(0, 8))).toEqual(["31ba5db7", "aaaaaaaa", "bbbbbbbb"]);
  });

  it("matches product names, notes, and the delivery address", () => {
    expect(filterOrdersByQuery(list, "rice").map((item) => item.id.slice(0, 8))).toEqual([
      "31ba5db7",
    ]);
    expect(filterOrdersByQuery(list, "call before").length).toBe(1);
    expect(filterOrdersByQuery(list, "chattogram").length).toBe(1);
    expect(filterOrdersByQuery(list, "nothing-matches")).toEqual([]);
    expect(filterOrdersByQuery(list, "   ")).toHaveLength(3);
  });

  it("accepts the compact order reference shown in the UI", () => {
    expect(filterOrdersByQuery(list, "31BA5DB7").length).toBe(1);
    expect(filterOrdersByQuery(list, "31ba5db7").length).toBe(1);
    // Fragments of the raw id also match, like any substring search.
    expect(filterOrdersByQuery(list, "31b").length).toBe(1);
  });
});
