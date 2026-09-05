import { describe, expect, it } from "vite-plus/test";
import {
  RELATED_PRODUCT_LIMIT,
  relatedProducts,
  type RetailerProduct,
} from "./retailer-catalog-api.ts";

let sequence = 0;

function product(overrides: Partial<RetailerProduct> = {}): RetailerProduct {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${`${sequence}`.padStart(12, "0")}`,
    name: `Product ${sequence}`,
    description: "Test product",
    price: 100,
    unit: "kg",
    stock: 50,
    min_order_qty: 1,
    category: "Rice & Grains",
    image_url: null,
    seller_id: "seller-1",
    seller_name: "Supplier One",
    ...overrides,
  };
}

describe("relatedProducts", () => {
  it("puts same-supplier products first, then same-category, and excludes the product itself", () => {
    const current = product();
    const sameSupplier = product();
    const sameCategoryOtherSupplier = product({ seller_id: "seller-2" });
    const otherSupplierOtherCategory = product({
      seller_id: "seller-2",
      category: "Spices",
    });

    const related = relatedProducts(
      [current, sameSupplier, sameCategoryOtherSupplier, otherSupplierOtherCategory],
      current,
    );

    expect(related).toEqual([sameSupplier, sameCategoryOtherSupplier]);
  });

  it("returns a candidate matching both supplier and category only once", () => {
    const current = product();
    const both = product();

    const related = relatedProducts([current, both], current);

    expect(related).toEqual([both]);
  });

  it("caps the results at the related-product limit", () => {
    const current = product();
    const many = Array.from({ length: RELATED_PRODUCT_LIMIT + 5 }, () => product());

    const related = relatedProducts([current, ...many], current);

    expect(related).toHaveLength(RELATED_PRODUCT_LIMIT);
  });

  it("returns nothing for a product without supplier or category", () => {
    const current = product({ seller_id: null, seller_name: null, category: null });
    const other = product();

    const related = relatedProducts([current, other], current);

    expect(related).toEqual([]);
  });
});
