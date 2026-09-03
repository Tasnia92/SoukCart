/* -----------------------------------------------------------------------------
 * Supplier dashboard contract — fulfillment and inventory in one response:
 * `summary`, `series`, `queue` (orders to act on), `stockRisk`, `topProducts` and
 * a small `recentListings` tail.
 * -----------------------------------------------------------------------------
 * `buildSupplierDashboard` is pure. `loadSupplierDashboard` fetches the supplier's
 * orders and products together so the overview issues one coordinated load instead
 * of downloading a catalog and re-deriving totals per render.
 * -------------------------------------------------------------------------- */

import {
  DEFAULT_WINDOW_DAYS,
  ageInDays,
  dailySeries,
  distribution,
  isWithinWindow,
  periodDelta,
  sumPreviousWindow,
  sumWindow,
  type DashboardBucket,
  type DashboardSeverity,
  type MetricDelta,
  type SizedSegment,
} from "../../components/dashboard/dashboard-model.ts";
import { supabase } from "../../supabase.ts";
import { loadSupplierOrders, type SupplierOrder } from "./supplier-orders-api.ts";
import { loadSupplierProducts, type SupplierProduct } from "./supplier-overview-api.ts";

/** At or below this many units a listing is flagged before it sells out. */
export const LOW_STOCK_THRESHOLD = 5;

export const SUPPLIER_QUEUE_LIMIT = 6;
export const SUPPLIER_STOCK_RISK_LIMIT = 5;
export const SUPPLIER_TOP_PRODUCT_LIMIT = 5;
export const SUPPLIER_RECENT_LISTING_LIMIT = 3;

export type SupplierSummary = {
  sales: number;
  salesDelta: MetricDelta;
  orders: number;
  awaitingFulfillment: number;
  cancellationRequests: number;
  lowStock: number;
  outOfStock: number;
  stockAtRisk: number;
  activeListings: number;
  totalListings: number;
};

export type SupplierQueueOrder = {
  id: string;
  retailerName: string;
  retailerEmail: string;
  createdAt: string;
  ageDays: number;
  units: number;
  total: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  accepted: boolean;
  cancelRequested: boolean;
  severity: DashboardSeverity;
};

export type SupplierStockRisk = {
  id: string;
  name: string;
  unit: string;
  stock: number;
  isActive: boolean;
  severity: DashboardSeverity;
};

export type SupplierTopProduct = {
  id: string;
  name: string;
  units: number;
  value: number;
};

export type SellerEarnings = {
  commissionRate: number;
  available: number;
  paid: number;
  commission: number;
};

export const EMPTY_SELLER_EARNINGS: SellerEarnings = {
  commissionRate: 0,
  available: 0,
  paid: 0,
  commission: 0,
};

export type SupplierDashboard = {
  summary: SupplierSummary;
  /** One point per day: `value` is the supplier's earnings, `count` is order lines received. */
  series: DashboardBucket[];
  queue: SupplierQueueOrder[];
  stockRisk: SupplierStockRisk[];
  stockHealth: { total: number; segments: SizedSegment[] };
  topProducts: SupplierTopProduct[];
  recentListings: SupplierProduct[];
  windowDays: number;
  earnings: SellerEarnings;
};

function asMoney(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export async function loadSellerEarnings(): Promise<SellerEarnings> {
  const { data, error } = await supabase.rpc("seller_earnings");
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object") return EMPTY_SELLER_EARNINGS;
  const row = data as Record<string, unknown>;
  return {
    commissionRate: asMoney(row.commissionRate),
    available: asMoney(row.available),
    paid: asMoney(row.paid),
    commission: asMoney(row.commission),
  };
}

function isEarning(order: SupplierOrder): boolean {
  return order.status !== "cancelled" && order.payment_status === "paid";
}

/** Pending or confirmed orders the supplier still has to confirm or ship. */
export function awaitsFulfillment(order: SupplierOrder): boolean {
  return (
    (order.status === "pending" || order.status === "confirmed") &&
    !order.cancel_requested &&
    (order.payment_method === "cod" || order.payment_status === "paid")
  );
}

export function hasOpenCancellation(order: SupplierOrder): boolean {
  return order.cancel_requested && order.status !== "cancelled";
}

function orderUnits(order: SupplierOrder): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

/** Unconfirmed orders turn critical once they have sat for more than a day. */
function queueSeverity(order: SupplierOrder, now: number): DashboardSeverity {
  if (hasOpenCancellation(order)) return "critical";
  return ageInDays(order.created_at, now) >= 1 ? "critical" : "attention";
}

function stockSeverity(product: SupplierProduct): DashboardSeverity {
  if (product.stock <= 0) return "critical";
  return product.stock <= LOW_STOCK_THRESHOLD ? "attention" : "positive";
}

/**
 * Aggregates the supplier overview. Sales exclude cancelled orders. The queue holds
 * only orders the supplier can act on now, oldest first, because an unconfirmed order
 * only gets more expensive with age.
 */
export function buildSupplierDashboard(
  orders: readonly SupplierOrder[],
  products: readonly SupplierProduct[],
  now = Date.now(),
  windowDays = DEFAULT_WINDOW_DAYS,
): SupplierDashboard {
  const earning = orders.filter(isEarning);
  const salesItems = earning.map((order) => ({
    at: order.created_at,
    value: order.supplier_total,
  }));
  const sales = sumWindow(salesItems, now, windowDays);
  const previousSales = sumPreviousWindow(salesItems, now, windowDays);

  const pending = orders.filter(awaitsFulfillment);
  const cancellations = orders.filter(hasOpenCancellation);

  const queue = [...pending, ...cancellations]
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))
    .slice(0, SUPPLIER_QUEUE_LIMIT)
    .map<SupplierQueueOrder>((order) => ({
      id: order.id,
      retailerName: order.retailer_name,
      retailerEmail: order.retailer_email,
      createdAt: order.created_at,
      ageDays: ageInDays(order.created_at, now),
      units: orderUnits(order),
      total: order.supplier_total,
      status: order.status,
      paymentStatus: order.payment_status,
      paymentMethod: order.payment_method,
      accepted: Boolean(order.accepted_at),
      cancelRequested: order.cancel_requested,
      severity: queueSeverity(order, now),
    }));

  const active = products.filter((product) => product.is_active);
  const outOfStock = active.filter((product) => product.stock <= 0);
  const lowStock = active.filter(
    (product) => product.stock > 0 && product.stock <= LOW_STOCK_THRESHOLD,
  );
  const healthy = active.filter((product) => product.stock > LOW_STOCK_THRESHOLD);

  const stockRisk = [...outOfStock, ...lowStock]
    .sort((left, right) => left.stock - right.stock)
    .slice(0, SUPPLIER_STOCK_RISK_LIMIT)
    .map<SupplierStockRisk>((product) => ({
      id: product.id,
      name: product.name,
      unit: product.unit,
      stock: product.stock,
      isActive: product.is_active,
      severity: stockSeverity(product),
    }));

  const totals = new Map<string, SupplierTopProduct>();
  for (const order of earning) {
    if (!isWithinWindow(order.created_at, now, windowDays)) continue;
    for (const item of order.items) {
      const existing = totals.get(item.product_id);
      if (existing) {
        existing.units += item.quantity;
        existing.value += item.line_total;
        continue;
      }
      totals.set(item.product_id, {
        id: item.product_id,
        name: item.product_name,
        units: item.quantity,
        value: item.line_total,
      });
    }
  }

  const topProducts = [...totals.values()]
    .sort((left, right) => right.value - left.value || right.units - left.units)
    .slice(0, SUPPLIER_TOP_PRODUCT_LIMIT);

  return {
    summary: {
      sales,
      salesDelta: periodDelta(sales, previousSales, windowDays),
      orders: earning.filter((order) => isWithinWindow(order.created_at, now, windowDays)).length,
      awaitingFulfillment: pending.length,
      cancellationRequests: cancellations.length,
      lowStock: lowStock.length,
      outOfStock: outOfStock.length,
      stockAtRisk: lowStock.length + outOfStock.length,
      activeListings: active.length,
      totalListings: products.length,
    },
    series: dailySeries(salesItems, now, windowDays),
    queue,
    stockRisk,
    stockHealth: distribution([
      { key: "healthy", label: "Well stocked", count: healthy.length, severity: "positive" },
      { key: "low", label: "Running low", count: lowStock.length, severity: "attention" },
      { key: "out", label: "Out of stock", count: outOfStock.length, severity: "critical" },
    ]),
    topProducts,
    recentListings: [...products]
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
      .slice(0, SUPPLIER_RECENT_LISTING_LIMIT),
    windowDays,
    earnings: EMPTY_SELLER_EARNINGS,
  };
}

export type SupplierDashboardDeps = {
  loadOrders: () => Promise<SupplierOrder[]>;
  loadProducts: (sellerId: string) => Promise<SupplierProduct[]>;
  loadEarnings?: () => Promise<SellerEarnings>;
};

const defaultDeps: SupplierDashboardDeps = {
  loadOrders: loadSupplierOrders,
  loadProducts: loadSupplierProducts,
  loadEarnings: loadSellerEarnings,
};

export async function loadSupplierDashboard(
  sellerId: string,
  deps: SupplierDashboardDeps = defaultDeps,
  now = Date.now(),
): Promise<SupplierDashboard> {
  const [orders, products, earnings] = await Promise.all([
    deps.loadOrders(),
    deps.loadProducts(sellerId),
    deps.loadEarnings ? deps.loadEarnings() : Promise.resolve(EMPTY_SELLER_EARNINGS),
  ]);
  return { ...buildSupplierDashboard(orders, products, now), earnings };
}
