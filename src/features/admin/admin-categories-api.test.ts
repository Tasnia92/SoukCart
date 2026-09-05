import { describe, expect, it } from "vite-plus/test";
import type { AdminCategory } from "./admin-categories-api.ts";
import {
  categoryDescriptionValidationError,
  categoryValidationError,
  filterAdminCategories,
  findDuplicateCategoryName,
  getAdminCategoryStats,
  replaceAdminCategory,
  sortAdminCategories,
} from "./admin-categories-api.ts";

let sequence = 0;

function category(overrides: Partial<AdminCategory> = {}): AdminCategory {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${`${sequence}`.padStart(12, "0")}`,
    name: `Category ${sequence}`,
    description: "",
    sort_order: sequence * 10,
    is_active: true,
    product_count: 0,
    created_by: null,
    created_at: "2026-09-01T09:00:00Z",
    updated_at: "2026-09-01T09:00:00Z",
    ...overrides,
  };
}

describe("categoryValidationError", () => {
  it("rejects blank names", () => {
    expect(categoryValidationError("")).toBe("Give the category a name.");
    expect(categoryValidationError("   ")).toBe("Give the category a name.");
  });

  it("rejects names over 60 characters", () => {
    expect(categoryValidationError("a".repeat(61))).toMatch(/under 60 characters/);
  });

  it("accepts a normal name", () => {
    expect(categoryValidationError("Rice & Grains")).toBeNull();
    expect(categoryValidationError("a".repeat(60))).toBeNull();
  });
});

describe("categoryDescriptionValidationError", () => {
  it("rejects descriptions over 280 characters", () => {
    expect(categoryDescriptionValidationError("a".repeat(281))).toMatch(/under 280 characters/);
  });

  it("accepts short or empty descriptions", () => {
    expect(categoryDescriptionValidationError("")).toBeNull();
    expect(categoryDescriptionValidationError("Bulk sacks of rice.")).toBeNull();
  });
});

describe("findDuplicateCategoryName", () => {
  const list = [
    category({ name: "Rice & Grains", sort_order: 10 }),
    category({ name: "Spices", sort_order: 20 }),
  ];

  it("matches names case-insensitively and ignores whitespace", () => {
    expect(findDuplicateCategoryName(list, "  spices ")?.name).toBe("Spices");
  });

  it("ignores the category being edited", () => {
    const target = list[1];
    expect(findDuplicateCategoryName(list, "spices", target.id)).toBeNull();
  });

  it("returns null for unique names", () => {
    expect(findDuplicateCategoryName(list, "Oils & Ghee")).toBeNull();
    expect(findDuplicateCategoryName(list, "")).toBeNull();
  });
});

describe("filterAdminCategories", () => {
  const list = [
    category({ name: "Rice & Grains", description: "Bulk sacks" }),
    category({ name: "Spices", description: "Ground and whole" }),
  ];

  it("returns everything for a blank query", () => {
    expect(filterAdminCategories(list, "  ")).toHaveLength(2);
  });

  it("matches names or descriptions", () => {
    expect(filterAdminCategories(list, "spice").map((item) => item.name)).toEqual(["Spices"]);
    expect(filterAdminCategories(list, "SACKS").map((item) => item.name)).toEqual([
      "Rice & Grains",
    ]);
    expect(filterAdminCategories(list, "nothing")).toEqual([]);
  });
});

describe("sortAdminCategories", () => {
  it("orders by sort order then name", () => {
    const sorted = sortAdminCategories([
      category({ name: "B", sort_order: 10 }),
      category({ name: "A", sort_order: 10 }),
      category({ name: "Z", sort_order: 5 }),
    ]);
    expect(sorted.map((item) => item.name)).toEqual(["Z", "A", "B"]);
  });

  it("does not mutate the input", () => {
    const list = [category({ name: "B", sort_order: 10 }), category({ name: "A", sort_order: 5 })];
    sortAdminCategories(list);
    expect(list.map((item) => item.name)).toEqual(["B", "A"]);
  });
});

describe("replaceAdminCategory", () => {
  it("replaces an existing category and re-sorts", () => {
    const existing = category({ name: "Spices", sort_order: 20 });
    const list = [category({ name: "Rice & Grains", sort_order: 10 }), existing];
    const next = replaceAdminCategory(list, { ...existing, name: "Aromatic Spices" });
    expect(next.map((item) => item.name)).toEqual(["Rice & Grains", "Aromatic Spices"]);
  });

  it("appends a new category and re-sorts", () => {
    const list = [category({ name: "Spices", sort_order: 20 })];
    const next = replaceAdminCategory(list, category({ name: "Rice & Grains", sort_order: 10 }));
    expect(next.map((item) => item.name)).toEqual(["Rice & Grains", "Spices"]);
  });
});

describe("getAdminCategoryStats", () => {
  it("counts active, hidden and in-use categories", () => {
    const stats = getAdminCategoryStats([
      category({ product_count: 3 }),
      category({ is_active: false }),
      category({ product_count: 1 }),
    ]);
    expect(stats).toEqual({ total: 3, active: 2, hidden: 1, inUse: 2 });
  });

  it("handles an empty list", () => {
    expect(getAdminCategoryStats([])).toEqual({ total: 0, active: 0, hidden: 0, inUse: 0 });
  });
});
