import { supabase } from "../../supabase.ts";
import {
  loadCartQuantities,
  loadRetailerProducts,
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

export function cartItemCount(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
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

export function assertSingleSupplierCart(lines: readonly CartLine[]): void {
  const sellerIds = new Set(
    lines
      .map((line) => line.product.seller_id)
      .filter((sellerId): sellerId is string => Boolean(sellerId)),
  );
  if (sellerIds.size > 1) {
    throw new Error("Checkout one supplier at a time. Remove items from other suppliers first.");
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
