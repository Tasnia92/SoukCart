import { describe, expect, it } from "vite-plus/test";
import type { AdminProduct } from "./admin-products-api.ts";
import {
  ADMIN_PRODUCT_SORTS,
  filterAdminProducts,
  parseAdminProductSort,
  sortAdminProducts,
} from "./admin-products-api.ts";

let sequence = 0;

function product(overrides: Partial<AdminProduct> = {}): AdminProduct {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${`${sequence}`.padStart(12, "0")}`,
    seller_id: null,
    name: `Product ${sequence}`,
    description: "",
    price: 100,
    unit: "kg",
    stock: 10,
    min_order_qty: 1,
    category: null,
    image_url: null,
    is_active: true,
    moderation_status: "ok",
    moderation_reason: null,
    moderated_by: null,
    moderated_at: null,
    created_at: "2026-09-01T09:00:00Z",
    seller_name: "Supplier",
    seller_email: "supplier@example.com",
    shop_name: null,
    ...overrides,
  };
}

describe("sortAdminProducts", () => {
  const oldest = product({ created_at: "2026-08-01T09:00:00Z" });
  const middle = product({ created_at: "2026-08-20T09:00:00Z" });
  const newest = product({ created_at: "2026-09-04T09:00:00Z" });

  it("sorts new to old by default and for the newest option", () => {
    expect(sortAdminProducts([oldest, newest, middle], "newest")).toEqual([newest, middle, oldest]);
  });

  it("sorts old to new for the oldest option", () => {
    expect(sortAdminProducts([newest, oldest, middle], "oldest")).toEqual([oldest, middle, newest]);
  });

  it("does not mutate the input array", () => {
    const input = [oldest, newest, middle];
    sortAdminProducts(input, "oldest");
    expect(input).toEqual([oldest, newest, middle]);
  });
});

describe("parseAdminProductSort", () => {
  it("falls back to newest for unknown values", () => {
    expect(parseAdminProductSort(null)).toBe("newest");
    expect(parseAdminProductSort("nonsense")).toBe("newest");
    expect(parseAdminProductSort("oldest")).toBe("oldest");
  });
});

describe("ADMIN_PRODUCT_SORTS", () => {
  it("offers new-to-old and old-to-new", () => {
    expect(ADMIN_PRODUCT_SORTS.map((option) => option.id)).toEqual(["newest", "oldest"]);
  });
});

describe("filterAdminProducts + sortAdminProducts", () => {
  it("applies the sort to the filtered result", () => {
    const products = [
      product({ name: "Rice", created_at: "2026-08-01T09:00:00Z" }),
      product({ name: "Eggs", created_at: "2026-09-01T09:00:00Z" }),
    ];
    const sorted = sortAdminProducts(filterAdminProducts(products, "", "all"), "oldest");
    expect(sorted.map((item) => item.name)).toEqual(["Rice", "Eggs"]);
  });
});
