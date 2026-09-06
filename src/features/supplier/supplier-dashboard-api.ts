/* -----------------------------------------------------------------------------
 * Supplier dashboard contract — fulfillment and inventory in one response:
 * `summary`, `series`, `queue` (orders to act on), `stockRisk`, `topProducts` and
 * a small `recentListings` tail.
 * -----------------------------------------------------------------------------
 * Prefer `seller_dashboard_summary` on the server. `buildSupplierDashboard` stays
 * pure for unit tests and as a client-side fallback when the RPC is unavailable.
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
import {
  loadSupplierProducts,
  normalizeSupplierProduct,
  type SupplierProduct,
} from "./supplier-overview-api.ts";

/** At or below this many units a listing is flagged before it sells out. */
export const LOW_STOCK_THRESHOLD = 5;

export const SUPPLIER_QUEUE_LIMIT = 6;
export const SUPPLIER_STOCK_RISK_LIMIT = 5;
export const SUPPLIER_TOP_PRODUCT_LIMIT = 5;
export const SUPPLIER_RECENT_LISTING_LIMIT = 3;

export const SUPPLIER_WINDOW_OPTIONS = [7, 30, 90] as const;
export type SupplierWindowDays = (typeof SUPPLIER_WINDOW_OPTIONS)[number];

export type SupplierSummary = {
  sales: number;
  salesDelta: MetricDelta;
  orders: number;
  ordersCompleted: number;
  toConfirm: number;
  toShip: number;
  awaitingPayment: number;
  awaitingFulfillment: number;
  cancellationRequests: number;
  lowStock: number;
  outOfStock: number;
  stockAtRisk: number;
  activeListings: number;
  totalListings: number;
  netEarnings: number;
};

export type SupplierQueueOrder = {
  id: string;
  retailerName: string;
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

export type SellerEarningsRowStatus = "available" | "paid" | "reversed";

export type SellerEarningsRow = {
  id: string;
  orderId: string;
  gross: number;
  commissionRate: number;
  commissionAmount: number;
  netPayable: number;
  status: SellerEarningsRowStatus;
  accruedAt: string;
  paidAt: string | null;
};

export type SellerEarnings = {
  commissionRate: number;
  available: number;
  paid: number;
  commission: number;
  rows: SellerEarningsRow[];
};

export const EMPTY_SELLER_EARNINGS: SellerEarnings = {
  commissionRate: 0,
  available: 0,
  paid: 0,
  commission: 0,
  rows: [],
};

export type SupplierDashboard = {
  summary: SupplierSummary;
  /** One point per day: `value` is gross sales, `count` is paid orders that day. */
  series: DashboardBucket[];
  queue: SupplierQueueOrder[];
  stockRisk: SupplierStockRisk[];
  stockHealth: { total: number; segments: SizedSegment[] };
  topProducts: SupplierTopProduct[];
  recentListings: SupplierProduct[];
  windowDays: number;
  earnings: SellerEarnings;
};

export type SellerNavBadges = {
  needsAction: number;
  stockAtRisk: number;
  unreadNotifications: number;
};

export const EMPTY_SELLER_NAV_BADGES: SellerNavBadges = {
  needsAction: 0,
  stockAtRisk: 0,
  unreadNotifications: 0,
};

export function isProductOutOfStock(product: Pick<SupplierProduct, "stock">): boolean {
  return product.stock <= 0;
}

export function isProductLowStock(product: Pick<SupplierProduct, "stock">): boolean {
  return product.stock > 0 && product.stock <= LOW_STOCK_THRESHOLD;
}

export function isProductAtRisk(product: Pick<SupplierProduct, "stock">): boolean {
  return product.stock <= LOW_STOCK_THRESHOLD;
}

function asMoney(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function asInt(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.trunc(amount) : 0;
}

function asMetricDelta(value: unknown, windowDays: number): MetricDelta {
  if (!value || typeof value !== "object") {
    return periodDelta(0, 0, windowDays);
  }
  const row = value as Record<string, unknown>;
  const direction = row.direction;
  if (direction !== "up" && direction !== "down" && direction !== "flat" && direction !== "new") {
    return periodDelta(asMoney(row.current), asMoney(row.previous), windowDays);
  }
  return {
    direction,
    percent: row.percent === null || row.percent === undefined ? null : asInt(row.percent),
    label: typeof row.label === "string" ? row.label : `vs previous ${windowDays} days`,
  };
}

function payoutStatus(value: unknown): SellerEarningsRowStatus {
  return value === "paid" || value === "reversed" ? value : "available";
}

function normalizeEarningsRow(value: unknown): SellerEarningsRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !row.id ||
    typeof row.orderId !== "string" ||
    !row.orderId ||
    typeof row.accruedAt !== "string" ||
    !row.accruedAt
  ) {
    return null;
  }
  return {
    id: row.id,
    orderId: row.orderId,
    gross: asMoney(row.gross),
    commissionRate: asMoney(row.commissionRate),
    commissionAmount: asMoney(row.commissionAmount),
    netPayable: asMoney(row.netPayable),
    status: payoutStatus(row.status),
    accruedAt: row.accruedAt,
    paidAt: typeof row.paidAt === "string" && row.paidAt ? row.paidAt : null,
  };
}

/** Pure parser for `seller_earnings` JSONB — keeps totals and ledger rows defensive. */
export function normalizeSellerEarnings(data: unknown): SellerEarnings {
  if (!data || typeof data !== "object") return EMPTY_SELLER_EARNINGS;
  const row = data as Record<string, unknown>;
  const rows = Array.isArray(row.rows)
    ? row.rows
        .map(normalizeEarningsRow)
        .filter((entry): entry is SellerEarningsRow => entry !== null)
    : [];
  return {
    commissionRate: asMoney(row.commissionRate),
    available: asMoney(row.available),
    paid: asMoney(row.paid),
    commission: asMoney(row.commission),
    rows,
  };
}

export async function loadSellerEarnings(): Promise<SellerEarnings> {
  const { data, error } = await supabase.rpc("seller_earnings");
  if (error) throw new Error(error.message);
  return normalizeSellerEarnings(data);
}

export async function loadSellerNavBadges(): Promise<SellerNavBadges> {
  const { data, error } = await supabase.rpc("seller_nav_badges");
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object") return EMPTY_SELLER_NAV_BADGES;
  const row = data as Record<string, unknown>;
  return {
    needsAction: asInt(row.needsAction),
    stockAtRisk: asInt(row.stockAtRisk),
    unreadNotifications: asInt(row.unreadNotifications),
  };
}

function isEarning(order: SupplierOrder): boolean {
  return order.status !== "cancelled" && order.payment_status === "paid";
}

/** Pending or confirmed orders the supplier still has to confirm or ship. */
export function awaitsFulfillment(order: SupplierOrder): boolean {
  return (
    (order.package_status === "pending" || order.package_status === "confirmed") &&
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
  if (isProductOutOfStock(product)) return "critical";
  return isProductLowStock(product) ? "attention" : "positive";
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
  earnings: SellerEarnings = EMPTY_SELLER_EARNINGS,
): SupplierDashboard {
  const earning = orders.filter(isEarning);
  const salesItems = earning.map((order) => ({
    at: order.created_at,
    value: order.supplier_total,
  }));
  const sales = sumWindow(salesItems, now, windowDays);
  const previousSales = sumPreviousWindow(salesItems, now, windowDays);

  const toConfirm = orders.filter(
    (order) =>
      order.package_status === "pending" &&
      !order.cancel_requested &&
      (order.payment_method === "cod" || order.payment_status === "paid"),
  );
  const toShip = orders.filter(
    (order) =>
      order.package_status === "confirmed" &&
      !order.cancel_requested &&
      (order.payment_method === "cod" || order.payment_status === "paid"),
  );
  const awaitingPayment = orders.filter(
    (order) =>
      order.status === "pending" &&
      order.payment_method !== "cod" &&
      order.payment_status !== "paid" &&
      !order.cancel_requested,
  );
  const pending = orders.filter(awaitsFulfillment);
  const cancellations = orders.filter(hasOpenCancellation);
  const ordersCompleted = earning.filter(
    (order) => order.status === "delivered" && isWithinWindow(order.created_at, now, windowDays),
  ).length;

  const queue = [...pending, ...cancellations]
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))
    .slice(0, SUPPLIER_QUEUE_LIMIT)
    .map<SupplierQueueOrder>((order) => ({
      id: order.id,
      retailerName: order.retailer_name,
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
  const outOfStock = active.filter(isProductOutOfStock);
  const lowStock = active.filter(isProductLowStock);
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
      ordersCompleted,
      toConfirm: toConfirm.length,
      toShip: toShip.length,
      awaitingPayment: awaitingPayment.length,
      awaitingFulfillment: pending.length,
      cancellationRequests: cancellations.length,
      lowStock: lowStock.length,
      outOfStock: outOfStock.length,
      stockAtRisk: lowStock.length + outOfStock.length,
      activeListings: active.length,
      totalListings: products.length,
      netEarnings: earnings.available + earnings.paid,
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
    earnings,
  };
}

function normalizeQueueOrder(value: unknown): SupplierQueueOrder | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string") return null;
  const severity = row.severity;
  return {
    id: row.id,
    retailerName: typeof row.retailerName === "string" ? row.retailerName : "Retailer",
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    ageDays: asInt(row.ageDays),
    units: asInt(row.units),
    total: asMoney(row.total),
    status: typeof row.status === "string" ? row.status : "pending",
    paymentStatus: typeof row.paymentStatus === "string" ? row.paymentStatus : "unpaid",
    paymentMethod: typeof row.paymentMethod === "string" ? row.paymentMethod : "online",
    accepted: row.accepted === true,
    cancelRequested: row.cancelRequested === true,
    severity:
      severity === "critical" || severity === "attention" || severity === "positive"
        ? severity
        : "neutral",
  };
}

function normalizeStockRisk(value: unknown): SupplierStockRisk | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  const severity = row.severity;
  return {
    id: row.id,
    name: row.name,
    unit: typeof row.unit === "string" ? row.unit : "unit",
    stock: asInt(row.stock),
    isActive: row.isActive !== false,
    severity: severity === "critical" ? "critical" : "attention",
  };
}

function normalizeTopProduct(value: unknown): SupplierTopProduct | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  return {
    id: row.id,
    name: row.name,
    units: asInt(row.units),
    value: asMoney(row.value),
  };
}

function normalizeSeriesBucket(value: unknown): DashboardBucket | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.key !== "string" || typeof row.label !== "string") return null;
  return {
    key: row.key,
    label: row.label,
    startsAt: asInt(row.startsAt),
    value: asMoney(row.value),
    count: asInt(row.count),
  };
}

function normalizeSizedSegment(value: unknown): SizedSegment | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.key !== "string" || typeof row.label !== "string") return null;
  const severity = row.severity;
  return {
    key: row.key,
    label: row.label,
    count: asInt(row.count),
    severity:
      severity === "critical" ||
      severity === "attention" ||
      severity === "positive" ||
      severity === "neutral"
        ? severity
        : "neutral",
    percent: asInt(row.percent),
  };
}

export function normalizeSupplierDashboard(data: unknown): SupplierDashboard {
  if (!data || typeof data !== "object") {
    return buildSupplierDashboard([], [], Date.now(), DEFAULT_WINDOW_DAYS);
  }
  const row = data as Record<string, unknown>;
  const windowDays = asInt(row.windowDays) || DEFAULT_WINDOW_DAYS;
  const summaryRow =
    row.summary && typeof row.summary === "object" ? (row.summary as Record<string, unknown>) : {};
  const earnings = normalizeSellerEarnings(row.earnings);
  const stockHealthRow =
    row.stockHealth && typeof row.stockHealth === "object"
      ? (row.stockHealth as Record<string, unknown>)
      : {};
  const segments = Array.isArray(stockHealthRow.segments)
    ? stockHealthRow.segments
        .map(normalizeSizedSegment)
        .filter((entry): entry is SizedSegment => entry !== null)
    : [];

  const recentListings = Array.isArray(row.recentListings)
    ? row.recentListings
        .map((listing) => {
          if (!listing || typeof listing !== "object") return null;
          const product = listing as Record<string, unknown>;
          try {
            return normalizeSupplierProduct({
              id: typeof product.id === "string" ? product.id : "",
              name: typeof product.name === "string" ? product.name : "",
              description: typeof product.description === "string" ? product.description : "",
              price: product.price as number | string,
              unit: typeof product.unit === "string" ? product.unit : "unit",
              stock: asInt(product.stock),
              min_order_qty: product.min_order_qty as number | string | null,
              category: typeof product.category === "string" ? product.category : null,
              image_url: typeof product.image_url === "string" ? product.image_url : null,
              is_active: product.is_active !== false,
              created_at:
                typeof product.created_at === "string"
                  ? product.created_at
                  : new Date(0).toISOString(),
            });
          } catch {
            return null;
          }
        })
        .filter((entry): entry is SupplierProduct => entry !== null)
    : [];

  return {
    summary: {
      sales: asMoney(summaryRow.sales),
      salesDelta: asMetricDelta(summaryRow.salesDelta, windowDays),
      orders: asInt(summaryRow.orders),
      ordersCompleted: asInt(summaryRow.ordersCompleted),
      toConfirm: asInt(summaryRow.toConfirm),
      toShip: asInt(summaryRow.toShip),
      awaitingPayment: asInt(summaryRow.awaitingPayment),
      awaitingFulfillment: asInt(summaryRow.awaitingFulfillment),
      cancellationRequests: asInt(summaryRow.cancellationRequests),
      lowStock: asInt(summaryRow.lowStock),
      outOfStock: asInt(summaryRow.outOfStock),
      stockAtRisk: asInt(summaryRow.stockAtRisk),
      activeListings: asInt(summaryRow.activeListings),
      totalListings: asInt(summaryRow.totalListings),
      netEarnings: asMoney(summaryRow.netEarnings),
    },
    series: Array.isArray(row.series)
      ? row.series
          .map(normalizeSeriesBucket)
          .filter((entry): entry is DashboardBucket => entry !== null)
      : [],
    queue: Array.isArray(row.queue)
      ? row.queue
          .map(normalizeQueueOrder)
          .filter((entry): entry is SupplierQueueOrder => entry !== null)
      : [],
    stockRisk: Array.isArray(row.stockRisk)
      ? row.stockRisk
          .map(normalizeStockRisk)
          .filter((entry): entry is SupplierStockRisk => entry !== null)
      : [],
    stockHealth: {
      total: asInt(stockHealthRow.total),
      segments,
    },
    topProducts: Array.isArray(row.topProducts)
      ? row.topProducts
          .map(normalizeTopProduct)
          .filter((entry): entry is SupplierTopProduct => entry !== null)
      : [],
    recentListings,
    windowDays,
    earnings,
  };
}

export type SupplierDashboardDeps = {
  loadOrders: () => Promise<SupplierOrder[]>;
  loadProducts: (sellerId: string) => Promise<SupplierProduct[]>;
  loadEarnings?: () => Promise<SellerEarnings>;
  /** When provided, skips the server RPC (used by unit tests). */
  loadSummary?: (windowDays: number) => Promise<SupplierDashboard>;
};

const defaultDeps: SupplierDashboardDeps = {
  loadOrders: loadSupplierOrders,
  loadProducts: loadSupplierProducts,
  loadEarnings: loadSellerEarnings,
};

async function loadDashboardFromRpc(windowDays: number): Promise<SupplierDashboard> {
  const { data, error } = await supabase.rpc("seller_dashboard_summary", {
    p_window_days: windowDays,
  });
  if (error) throw new Error(error.message);
  return normalizeSupplierDashboard(data);
}

export async function loadSupplierDashboard(
  sellerId: string,
  deps: SupplierDashboardDeps = defaultDeps,
  now = Date.now(),
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<SupplierDashboard> {
  if (deps.loadSummary) {
    return deps.loadSummary(windowDays);
  }

  // Production path: one server aggregate. Tests inject loadOrders/loadProducts.
  if (deps === defaultDeps) {
    return loadDashboardFromRpc(windowDays);
  }

  const [orders, products, earnings] = await Promise.all([
    deps.loadOrders(),
    deps.loadProducts(sellerId),
    deps.loadEarnings ? deps.loadEarnings() : Promise.resolve(EMPTY_SELLER_EARNINGS),
  ]);
  return buildSupplierDashboard(orders, products, now, windowDays, earnings);
}
