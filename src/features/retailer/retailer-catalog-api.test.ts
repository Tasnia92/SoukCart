import { describe, expect, it } from "vite-plus/test";
import {
  filterProducts,
  getCategoryCounts,
  nextCartQuantity,
  type RetailerProduct,
} from "./retailer-catalog-api.ts";

function product(overrides: Partial<RetailerProduct>): RetailerProduct {
  return {
    id: "p1",
    name: "Atlas dates",
    description: "Sweet dates",
    price: 240,
    unit: "kg",
    stock: 10,
    category: "Groceries",
    image_url: null,
    seller_name: "Samira",
    ...overrides,
  };
}

describe("retailer catalog API", () => {
  it("filters by category and search across name, description, and seller", () => {
    const products = [
      product({ id: "a", name: "Atlas dates", category: "Groceries" }),
      product({ id: "b", name: "Olive oil", description: "Cold pressed", category: "Pantry" }),
      product({ id: "c", name: "Mint tea", seller_name: "Tea House", category: "Tea" }),
    ];

    expect(filterProducts(products, "", null).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(filterProducts(products, "", "Pantry").map((p) => p.id)).toEqual(["b"]);
    expect(filterProducts(products, "cold", null).map((p) => p.id)).toEqual(["b"]);
    expect(filterProducts(products, "tea house", null).map((p) => p.id)).toEqual(["c"]);
    expect(filterProducts(products, "atlas", "Tea").map((p) => p.id)).toEqual([]);
  });

  it("lists sorted category counts and ignores products without a category", () => {
    const products = [
      product({ id: "a", category: "Tea" }),
      product({ id: "b", category: "Groceries" }),
      product({ id: "c", category: "Tea" }),
      product({ id: "d", category: null }),
    ];

    expect(getCategoryCounts(products)).toEqual([
      { category: "Groceries", count: 1 },
      { category: "Tea", count: 2 },
    ]);
  });

  it("resolves the next cart quantity within stock", () => {
    expect(nextCartQuantity({ name: "Atlas dates", stock: 10 }, 2, 3)).toBe(5);
    expect(nextCartQuantity({ name: "Atlas dates", stock: 5 }, 0, 5)).toBe(5);
  });

  it("reports remaining stock with correct pluralization", () => {
    expect(() => nextCartQuantity({ name: "Atlas dates", stock: 5 }, 3, 3)).toThrow(
      "Only 2 more units of Atlas dates are in stock.",
    );
    expect(() => nextCartQuantity({ name: "Atlas dates", stock: 5 }, 4, 2)).toThrow(
      "Only 1 more unit of Atlas dates are in stock.",
    );
  });

  it("reports when all stock is already in the order", () => {
    expect(() => nextCartQuantity({ name: "Atlas dates", stock: 5 }, 5, 1)).toThrow(
      "You already have all 5 units of Atlas dates in your order.",
    );
    expect(() => nextCartQuantity({ name: "Single", stock: 1 }, 1, 1)).toThrow(
      "You already have all 1 unit of Single in your order.",
    );
  });
});
