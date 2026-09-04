import { supabase } from "../../supabase.ts";

export type SellerCustomerInsights = {
  summary: {
    windowDays: number;
    uniqueCustomers: number;
    repeatCustomers: number;
    orderCount: number;
    grossSales: number;
    averageOrderValue: number;
  };
  customers: Array<{
    retailerId: string;
    retailerName: string;
    retailerEmail: string;
    orderCount: number;
    grossSales: number;
    averageOrderValue: number;
    firstOrderAt: string;
    lastOrderAt: string;
    topCity: string | null;
    deliveredCount: number;
  }>;
  topCities: Array<{ city: string; orderCount: number; grossSales: number }>;
};

export type SellerCustomerRow = SellerCustomerInsights["customers"][number];
export type SellerCityRow = SellerCustomerInsights["topCities"][number];

export const EMPTY_SELLER_CUSTOMER_INSIGHTS: SellerCustomerInsights = {
  summary: {
    windowDays: 90,
    uniqueCustomers: 0,
    repeatCustomers: 0,
    orderCount: 0,
    grossSales: 0,
    averageOrderValue: 0,
  },
  customers: [],
  topCities: [],
};

function asMoney(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function asInt(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.trunc(amount) : 0;
}

function normalizeCustomer(value: unknown): SellerCustomerRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.retailerId !== "string" || !row.retailerId) return null;
  return {
    retailerId: row.retailerId,
    retailerName: typeof row.retailerName === "string" ? row.retailerName : "Retailer",
    retailerEmail: typeof row.retailerEmail === "string" ? row.retailerEmail : "",
    orderCount: asInt(row.orderCount),
    grossSales: asMoney(row.grossSales),
    averageOrderValue: asMoney(row.averageOrderValue),
    firstOrderAt: typeof row.firstOrderAt === "string" ? row.firstOrderAt : "",
    lastOrderAt: typeof row.lastOrderAt === "string" ? row.lastOrderAt : "",
    topCity: typeof row.topCity === "string" && row.topCity ? row.topCity : null,
    deliveredCount: asInt(row.deliveredCount),
  };
}

function normalizeCity(value: unknown): SellerCityRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.city !== "string" || !row.city) return null;
  return {
    city: row.city,
    orderCount: asInt(row.orderCount),
    grossSales: asMoney(row.grossSales),
  };
}

/** Pure parser for `seller_customer_insights` — empty defaults for bad payloads. */
export function normalizeSellerCustomerInsights(
  data: unknown,
  fallbackDays = 90,
): SellerCustomerInsights {
  if (!data || typeof data !== "object") {
    return {
      ...EMPTY_SELLER_CUSTOMER_INSIGHTS,
      summary: { ...EMPTY_SELLER_CUSTOMER_INSIGHTS.summary, windowDays: fallbackDays },
    };
  }

  const row = data as Record<string, unknown>;
  const summaryRow =
    row.summary && typeof row.summary === "object" ? (row.summary as Record<string, unknown>) : {};

  const windowDays = asInt(summaryRow.windowDays) || fallbackDays;

  return {
    summary: {
      windowDays,
      uniqueCustomers: asInt(summaryRow.uniqueCustomers),
      repeatCustomers: asInt(summaryRow.repeatCustomers),
      orderCount: asInt(summaryRow.orderCount),
      grossSales: asMoney(summaryRow.grossSales),
      averageOrderValue: asMoney(summaryRow.averageOrderValue),
    },
    customers: Array.isArray(row.customers)
      ? row.customers
          .map(normalizeCustomer)
          .filter((entry): entry is SellerCustomerRow => entry !== null)
      : [],
    topCities: Array.isArray(row.topCities)
      ? row.topCities.map(normalizeCity).filter((entry): entry is SellerCityRow => entry !== null)
      : [],
  };
}

export async function loadSellerCustomerInsights(days = 90): Promise<SellerCustomerInsights> {
  const windowDays = Math.max(1, Math.min(days, 365));
  const { data, error } = await supabase.rpc("seller_customer_insights", {
    p_days: windowDays,
  });
  if (error) throw new Error(error.message);
  return normalizeSellerCustomerInsights(data, windowDays);
}
