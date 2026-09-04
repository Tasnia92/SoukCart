import { describe, expect, it } from "vite-plus/test";
import {
  buildInventoryCsv,
  friendlyProductError,
  paginateProducts,
  parseInventoryCsv,
  productValidationError,
  sortSupplierProducts,
  type ProductPayload,
  type SupplierProduct,
} from "./supplier-products-api.ts";

const valid: ProductPayload = {
  name: "Miniket rice",
  description: "50 kg sack",
  price: 3500,
  unit: "sack",
  stock: 10,
  min_order_qty: 2,
  category: "Rice & Grains",
};

function product(overrides: Partial<SupplierProduct> = {}): SupplierProduct {
  return {
    id: "product-1",
    name: "Miniket rice",
    description: "50 kg sack",
    price: 3500,
    unit: "sack",
    stock: 10,
    min_order_qty: 2,
    category: "Rice & Grains",
    image_url: null,
    is_active: true,
    created_at: "2026-09-01T00:00:00.000Z",
    reorder_threshold: 5,
    stock_version: 1,
    ...overrides,
  };
}

describe("productValidationError", () => {
  it("accepts a valid wholesale listing", () => {
    expect(productValidationError(valid)).toBeNull();
  });

  it("requires a product image when adding a listing", () => {
    expect(productValidationError(valid, { requireImage: true })).toBe(
      "Please add a product image.",
    );
    expect(
      productValidationError(valid, {
        requireImage: true,
        imageUrl: "https://example.test/rice.jpg",
      }),
    ).toBeNull();
    expect(productValidationError(valid, { requireImage: true, hasImageFile: true })).toBeNull();
  });

  it("rejects a missing image even when an existing listing is being edited", () => {
    expect(
      productValidationError(valid, {
        allowZeroStock: true,
        requireImage: true,
        imageUrl: "   ",
      }),
    ).toBe("Please add a product image.");
  });
});

describe("catalog helpers", () => {
  it("sorts by stock ascending", () => {
    const sorted = sortSupplierProducts(
      [product({ id: "a", stock: 9, name: "B" }), product({ id: "b", stock: 2, name: "A" })],
      "stock",
    );
    expect(sorted.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("paginates catalog rows", () => {
    const items = Array.from({ length: 25 }, (_, index) => product({ id: `p-${index}` }));
    expect(paginateProducts(items, 2, 12)).toMatchObject({
      page: 2,
      pageCount: 3,
      total: 25,
    });
    expect(paginateProducts(items, 2, 12).items).toHaveLength(12);
  });

  it("round-trips inventory CSV product ids and stock", () => {
    const csv = buildInventoryCsv([
      product({ id: "aaa", stock: 4, reorder_threshold: 2 }),
      product({ id: "bbb", name: 'Rice, "special"', stock: 0 }),
    ]);
    expect(parseInventoryCsv(csv)).toEqual([
      { productId: "aaa", stock: 4, reorderThreshold: 2 },
      { productId: "bbb", stock: 0, reorderThreshold: 5 },
    ]);
  });

  it("maps concurrency conflicts to friendly copy", () => {
    expect(friendlyProductError(new Error("Stock changed elsewhere. Refresh and try again."))).toBe(
      "Stock changed elsewhere. Refresh and try again.",
    );
    expect(friendlyProductError(new Error("new row violates row-level security policy"))).toBe(
      "You do not have permission to change this product.",
    );
  });
});
