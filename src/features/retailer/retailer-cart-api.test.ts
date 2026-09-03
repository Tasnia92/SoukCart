import { describe, expect, it } from "vite-plus/test";
import type { RetailerProduct } from "./retailer-catalog-api.ts";
import {
  assertCartWithinStock,
  assertSingleSupplierCart,
  buildCheckoutBody,
  cartItemCount,
  cartSubtotal,
  clampCartQuantity,
  loadCartLines,
  type CartLine,
} from "./retailer-cart-api.ts";

function product(overrides: Partial<RetailerProduct>): RetailerProduct {
  return {
    id: "p1",
    name: "Atlas dates",
    description: "Sweet dates",
    price: 100,
    unit: "kg",
    stock: 10,
    min_order_qty: 1,
    category: "Groceries",
    image_url: null,
    seller_id: "seller-1",
    seller_name: "Samira",
    ...overrides,
  };
}

function line(overrides: Partial<CartLine>): CartLine {
  return { product: product({}), quantity: 1, ...overrides };
}

describe("retailer cart API", () => {
  it("builds cart lines from active products and cart quantities, dropping empties and unknowns", async () => {
    const products = [product({ id: "a" }), product({ id: "b" })];
    const lines = await loadCartLines("retailer-1", {
      products: async () => products,
      quantities: async () => ({ a: 2, b: 0, missing: 5 }),
    });

    expect(lines).toEqual([{ product: products[0], quantity: 2 }]);
  });

  it("computes item count and subtotal", () => {
    const lines = [
      line({ product: product({ id: "a", price: 100 }), quantity: 2 }),
      line({ product: product({ id: "b", price: 50 }), quantity: 3 }),
    ];
    expect(cartItemCount(lines)).toBe(5);
    expect(cartSubtotal(lines)).toBe(350);
  });

  it("clamps stepper quantity between 1 and stock", () => {
    expect(clampCartQuantity(3, 1, 5)).toBe(4);
    expect(clampCartQuantity(5, 1, 5)).toBe(5);
    expect(clampCartQuantity(1, -1, 5)).toBe(1);
    expect(clampCartQuantity(3, -1, 5)).toBe(2);
  });

  it("rejects a line that exceeds stock with the legacy message", () => {
    expect(() =>
      assertCartWithinStock([
        line({ product: product({ name: "Atlas dates", stock: 2 }), quantity: 5 }),
      ]),
    ).toThrow(
      "Only 2 units of Atlas dates are in stock, but your order has 5. Reduce the quantity and try again.",
    );
    expect(() =>
      assertCartWithinStock([line({ product: product({ name: "Solo", stock: 1 }), quantity: 2 })]),
    ).toThrow(
      "Only 1 unit of Solo are in stock, but your order has 2. Reduce the quantity and try again.",
    );
    expect(() =>
      assertCartWithinStock([line({ product: product({ stock: 10 }), quantity: 4 })]),
    ).not.toThrow();
    expect(() =>
      assertCartWithinStock([
        line({ product: product({ name: "Rice sack", min_order_qty: 10 }), quantity: 4 }),
      ]),
    ).toThrow("Order at least 10 units of Rice sack.");
  });

  it("rejects a mixed-supplier cart", () => {
    expect(() =>
      assertSingleSupplierCart([
        line({ product: product({ id: "a", seller_id: "seller-1" }), quantity: 1 }),
        line({ product: product({ id: "b", seller_id: "seller-2" }), quantity: 1 }),
      ]),
    ).toThrow("Checkout one supplier at a time. Remove items from other suppliers first.");
    expect(() =>
      assertSingleSupplierCart([
        line({ product: product({ id: "a", seller_id: "seller-1" }), quantity: 1 }),
        line({ product: product({ id: "b", seller_id: "seller-1" }), quantity: 2 }),
      ]),
    ).not.toThrow();
  });

  it("builds the unchanged checkout initiate body", () => {
    const body = buildCheckoutBody(
      "cod",
      { phone: "01", address: "road", city: "Dhaka", postcode: "1205", notes: "leave at door" },
      "https://app.test",
      "https://project.supabase.co",
    );
    expect(body).toEqual({
      action: "initiate",
      paymentMethod: "cod",
      checkout: {
        phone: "01",
        address: "road",
        city: "Dhaka",
        postcode: "1205",
        notes: "leave at door",
      },
      baseUrl: "https://app.test",
      ipnUrl: "https://project.supabase.co/functions/v1/sslcommerz-ipn",
    });
  });
});
