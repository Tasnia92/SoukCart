import { describe, expect, it } from "vite-plus/test";
import { cartItemCount, type CartLine } from "./retailer-cart-api.ts";
import type { RetailerProduct } from "./retailer-catalog-api.ts";

function line(quantity: number, overrides: Partial<RetailerProduct> = {}): CartLine {
  return {
    product: {
      id: `${quantity}-${overrides.name ?? "rice"}`,
      name: overrides.name ?? "Miniket rice",
      description: "Test product",
      price: 80,
      unit: "kg",
      stock: 50,
      min_order_qty: 1,
      category: "Rice & Grains",
      image_url: null,
      seller_id: "seller-1",
      seller_name: "Supplier One",
      ...overrides,
    },
    quantity,
  };
}

describe("cartItemCount", () => {
  it("counts distinct products, not total units", () => {
    const lines = [
      line(5),
      line(3, { name: "Soybean oil", id: "soybean-oil" }),
      line(40, { name: "Sugar", id: "sugar" }),
    ];

    expect(cartItemCount(lines)).toBe(3);
  });

  it("ignores lines whose quantity dropped to zero", () => {
    const lines = [line(0), line(2, { name: "Soybean oil", id: "soybean-oil" })];

    expect(cartItemCount(lines)).toBe(1);
  });

  it("returns zero for an empty cart", () => {
    expect(cartItemCount([])).toBe(0);
  });
});
