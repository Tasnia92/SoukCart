import { supabase } from "../../supabase.ts";
import {
  loadActiveProducts,
  loadCartQuantities,
  loadRetailerProducts,
  upsertCartItem,
  type RetailerProduct,
} from "./retailer-catalog-api.ts";

export type CartLine = { product: RetailerProduct; quantity: number };

export type PaymentMethod = "online" | "cod";

export type CheckoutForm = {
  phone: string;
  address: string;
  city: string;
  postcode: string;
  notes: string | null;
};

export type CheckoutOutcome = { url: string };

/** Flat prepaid delivery fee charged on every order (BDT). */
export const DEFAULT_DELIVERY_CHARGE = 60;

export function cartDeliveryCharge(): number {
  return DEFAULT_DELIVERY_CHARGE;
}

export function cartOrderTotal(lines: readonly CartLine[]): number {
  return cartSubtotal(lines) + cartDeliveryCharge();
}

/** Amount collected online at checkout: delivery only for COD, full total otherwise. */
export function cartPayableNow(lines: readonly CartLine[], method: PaymentMethod): number {
  return method === "cod" ? cartDeliveryCharge() : cartOrderTotal(lines);
}

type CartLineLoaders = {
  products: () => Promise<RetailerProduct[]>;
  quantities: (userId: string) => Promise<Record<string, number>>;
};

const defaultLoaders: CartLineLoaders = {
  products: loadRetailerProducts,
  quantities: loadCartQuantities,
};

export async function loadCartLines(
  userId: string,
  loaders: CartLineLoaders = defaultLoaders,
): Promise<CartLine[]> {
  const [products, quantities] = await Promise.all([
    loaders.products(),
    loaders.quantities(userId),
  ]);
  return Object.entries(quantities)
    .map(([productId, quantity]) => ({
      product: products.find((item) => item.id === productId),
      quantity,
    }))
    .filter((line): line is CartLine => Boolean(line.product) && line.quantity > 0);
}

/** Distinct products in the cart — badges count products, not units. */
export function cartItemCount(lines: readonly CartLine[]): number {
  return lines.filter((line) => line.quantity > 0).length;
}

export function cartSubtotal(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
}

// Stepper clamp: never exceed stock and never drop below the product MOQ.
export function clampCartQuantity(
  current: number,
  change: number,
  stock: number,
  minQty = 1,
): number {
  const floor = Math.max(1, minQty);
  const next = Math.min(current + change, stock);
  return next < floor ? current : next;
}

export async function updateCartQuantity(
  userId: string,
  productId: string,
  quantity: number,
): Promise<void> {
  const { error } = await supabase
    .from("cart_items")
    .update({ quantity })
    .eq("user_id", userId)
    .eq("product_id", productId);
  if (error) throw new Error(error.message);
}

export async function removeCartLine(userId: string, productId: string): Promise<void> {
  const { error } = await supabase
    .from("cart_items")
    .delete()
    .eq("user_id", userId)
    .eq("product_id", productId);
  if (error) throw new Error(error.message);
}

export type ReorderItem = { product_id: string; quantity: number };

export type ReorderOutcome = {
  /** Cart lines that could be restocked. */
  lines: number;
  /** Total units written to the cart. */
  units: number;
  /** Lines from the order that are no longer orderable. */
  unavailable: number;
};

/**
 * Maps a previous order's items onto the live catalog: clamp to current stock,
 * respect the minimum order quantity, and drop anything no longer orderable.
 */
export function reorderPlan(
  items: readonly ReorderItem[],
  products: readonly RetailerProduct[],
): CartLine[] {
  const plan: CartLine[] = [];
  for (const item of items) {
    const product = products.find((candidate) => candidate.id === item.product_id);
    if (!product || product.stock <= 0) continue;
    const minQty = Math.max(1, product.min_order_qty || 1);
    plan.push({ product, quantity: Math.min(Math.max(minQty, item.quantity), product.stock) });
  }
  return plan;
}

/** One-click reorder: rebuilds the cart from a past order's items. */
export async function reorderOrderItems(
  userId: string,
  items: readonly ReorderItem[],
  deps: {
    products?: () => Promise<RetailerProduct[]>;
    upsert?: (userId: string, productId: string, quantity: number) => Promise<void>;
  } = {},
): Promise<ReorderOutcome> {
  const products = await (deps.products ?? loadActiveProducts)();
  const plan = reorderPlan(items, products);
  const upsert = deps.upsert ?? upsertCartItem;
  for (const line of plan) {
    await upsert(userId, line.product.id, line.quantity);
  }
  return {
    lines: plan.length,
    units: plan.reduce((sum, line) => sum + line.quantity, 0),
    unavailable: items.length - plan.length,
  };
}

// Mirrors the pre-checkout stock guard: pending order items are checked against stock.
export function assertCartWithinStock(lines: readonly CartLine[]): void {
  for (const { product, quantity } of lines) {
    const minQty = Math.max(1, product.min_order_qty || 1);
    if (quantity < minQty) {
      throw new Error(
        `Order at least ${minQty} unit${minQty === 1 ? "" : "s"} of ${product.name}.`,
      );
    }
    if (quantity > product.stock) {
      throw new Error(
        `Only ${product.stock} unit${product.stock === 1 ? "" : "s"} of ${product.name} are in stock, but your order has ${quantity}. Reduce the quantity and try again.`,
      );
    }
  }
}

export function buildCheckoutBody(
  paymentMethod: PaymentMethod,
  form: CheckoutForm,
  origin: string,
  supabaseUrl: string,
): Record<string, unknown> {
  return {
    action: "initiate",
    paymentMethod,
    checkout: {
      phone: form.phone,
      address: form.address,
      city: form.city,
      postcode: form.postcode,
      notes: form.notes,
    },
    baseUrl: origin,
    ipnUrl: `${supabaseUrl}/functions/v1/sslcommerz-ipn`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function functionErrorMessage(error: unknown): string {
  if (isRecord(error) && isRecord(error.context) && typeof error.context.error === "string") {
    return error.context.error;
  }
  return error instanceof Error ? error.message : "The checkout could not be completed.";
}

export async function initiateCheckout(
  paymentMethod: PaymentMethod,
  form: CheckoutForm,
): Promise<CheckoutOutcome> {
  const body = buildCheckoutBody(
    paymentMethod,
    form,
    window.location.origin,
    import.meta.env.VITE_SUPABASE_URL,
  );
  const { data, error } = await supabase.functions.invoke("sslcommerz-checkout", { body });
  if (error) throw new Error(functionErrorMessage(error));
  const payload = isRecord(data) ? data : null;
  const url = typeof payload?.url === "string" ? payload.url : "";
  if (!url) throw new Error("The payment could not be started. Please try again.");
  return { url };
}
