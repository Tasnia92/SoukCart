import { describe, expect, it } from "vite-plus/test";
import {
  EMPTY_SELLER_CUSTOMER_INSIGHTS,
  normalizeSellerCustomerInsights,
} from "./supplier-customers-api.ts";

describe("normalizeSellerCustomerInsights", () => {
  it("returns empty defaults for null or non-object payloads", () => {
    expect(normalizeSellerCustomerInsights(null)).toEqual({
      ...EMPTY_SELLER_CUSTOMER_INSIGHTS,
      summary: { ...EMPTY_SELLER_CUSTOMER_INSIGHTS.summary, windowDays: 90 },
    });
    expect(normalizeSellerCustomerInsights("bad", 30).summary.windowDays).toBe(30);
    expect(normalizeSellerCustomerInsights(undefined, 365).customers).toEqual([]);
  });

  it("coerces numeric summary fields and drops malformed customers", () => {
    const insights = normalizeSellerCustomerInsights({
      summary: {
        windowDays: "30",
        uniqueCustomers: "4",
        repeatCustomers: "1",
        orderCount: "7",
        grossSales: "1500.5",
        averageOrderValue: "214.36",
      },
      customers: [
        {
          retailerId: "ret-1",
          retailerName: "Rani Retail",
          retailerEmail: "rani@example.com",
          orderCount: "3",
          grossSales: "900",
          averageOrderValue: "300",
          firstOrderAt: "2026-08-01T00:00:00.000Z",
          lastOrderAt: "2026-09-01T00:00:00.000Z",
          topCity: "Dhaka",
          deliveredCount: "2",
        },
        { retailerName: "Missing id" },
      ],
      topCities: [{ city: "Dhaka", orderCount: "5", grossSales: "1200" }, { orderCount: 1 }],
    });

    expect(insights.summary).toEqual({
      windowDays: 30,
      uniqueCustomers: 4,
      repeatCustomers: 1,
      orderCount: 7,
      grossSales: 1500.5,
      averageOrderValue: 214.36,
    });
    expect(insights.customers).toHaveLength(1);
    expect(insights.customers[0]).toMatchObject({
      retailerId: "ret-1",
      grossSales: 900,
      topCity: "Dhaka",
      deliveredCount: 2,
    });
    expect(insights.topCities).toEqual([{ city: "Dhaka", orderCount: 5, grossSales: 1200 }]);
  });

  it("treats blank topCity as null and missing arrays as empty", () => {
    const insights = normalizeSellerCustomerInsights({
      summary: { windowDays: 90 },
      customers: [
        {
          retailerId: "ret-2",
          retailerName: "No City",
          retailerEmail: "",
          topCity: "",
        },
      ],
    });

    expect(insights.customers[0]?.topCity).toBeNull();
    expect(insights.topCities).toEqual([]);
    expect(insights.summary.grossSales).toBe(0);
  });
});
