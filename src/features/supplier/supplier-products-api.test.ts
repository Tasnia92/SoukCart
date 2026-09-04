import { describe, expect, it } from "vite-plus/test";
import { productValidationError, type ProductPayload } from "./supplier-products-api.ts";

const valid: ProductPayload = {
  name: "Miniket rice",
  description: "50 kg sack",
  price: 3500,
  unit: "sack",
  stock: 10,
  min_order_qty: 2,
  category: "Rice & Grains",
};

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
