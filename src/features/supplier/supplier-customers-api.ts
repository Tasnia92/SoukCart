import { supabase } from "../../supabase.ts";

export type SellerCustomerInsights = {
  customers: Array<{
    retailerId: string;
    retailerName: string;
    orderCount: number;
    grossSales: number;
    averageOrderValue: number;
    firstOrderAt: string;
    lastOrderAt: string;
    topCity: string | null;
    deliveredCount: number;
  }>;
};

export type SellerCustomerRow = SellerCustomerInsights["customers"][number];

export const EMPTY_SELLER_CUSTOMER_INSIGHTS: SellerCustomerInsights = {
  customers: [],
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
    orderCount: asInt(row.orderCount),
    grossSales: asMoney(row.grossSales),
    averageOrderValue: asMoney(row.averageOrderValue),
    firstOrderAt: typeof row.firstOrderAt === "string" ? row.firstOrderAt : "",
    lastOrderAt: typeof row.lastOrderAt === "string" ? row.lastOrderAt : "",
    topCity: typeof row.topCity === "string" && row.topCity ? row.topCity : null,
    deliveredCount: asInt(row.deliveredCount),
  };
}

/** Pure parser for `seller_customer_insights` — empty defaults for bad payloads. */
export function normalizeSellerCustomerInsights(data: unknown): SellerCustomerInsights {
  if (!data || typeof data !== "object") return EMPTY_SELLER_CUSTOMER_INSIGHTS;

  const row = data as Record<string, unknown>;
  return {
    customers: Array.isArray(row.customers)
      ? row.customers
          .map(normalizeCustomer)
          .filter((entry): entry is SellerCustomerRow => entry !== null)
      : [],
  };
}

/** All-time retailer aggregates for the signed-in seller. */
export async function loadSellerCustomerInsights(): Promise<SellerCustomerInsights> {
  const { data, error } = await supabase.rpc("seller_customer_insights");
  if (error) throw new Error(error.message);
  return normalizeSellerCustomerInsights(data);
}
