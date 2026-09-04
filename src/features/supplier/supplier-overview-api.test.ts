import { describe, expect, it } from "vite-plus/test";
import {
  loadSupplierProducts,
  SUPPLIER_PRODUCT_COLUMNS,
  type SupplierProductsGateway,
} from "./supplier-overview-api.ts";

describe("supplier overview API", () => {
  it("queries only the seller's newest products with the preserved column contract", async () => {
    const calls: Array<{ method: string; values: unknown[] }> = [];
    const query = {
      eq(column: string, value: string) {
        calls.push({ method: "eq", values: [column, value] });
        return query;
      },
      async order(column: string, options: { ascending: boolean }) {
        calls.push({ method: "order", values: [column, options] });
        return {
          data: [
            {
              id: "product-1",
              name: "Miniket rice",
              description: "Fresh stock",
              price: "125.5",
              unit: "kg",
              stock: 12,
              min_order_qty: 1,
              category: null,
              image_url: null,
              is_active: true,
              created_at: "2026-08-31T09:00:00.000Z",
              reorder_threshold: 5,
              stock_version: 2,
            },
          ],
          error: null,
        };
      },
    };
    const gateway = {
      from(table: string) {
        calls.push({ method: "from", values: [table] });
        return {
          select(columns: string) {
            calls.push({ method: "select", values: [columns] });
            return query;
          },
        };
      },
    } as unknown as SupplierProductsGateway;

    await expect(loadSupplierProducts("seller-1", gateway)).resolves.toEqual([
      {
        id: "product-1",
        name: "Miniket rice",
        description: "Fresh stock",
        price: 125.5,
        unit: "kg",
        stock: 12,
        min_order_qty: 1,
        category: null,
        image_url: null,
        is_active: true,
        created_at: "2026-08-31T09:00:00.000Z",
        reorder_threshold: 5,
        stock_version: 2,
      },
    ]);
    expect(calls).toEqual([
      { method: "from", values: ["products"] },
      { method: "select", values: [SUPPLIER_PRODUCT_COLUMNS] },
      { method: "eq", values: ["seller_id", "seller-1"] },
      { method: "order", values: ["created_at", { ascending: false }] },
    ]);
  });

  it("surfaces the products query error without replacing its message", async () => {
    const gateway = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: async () => ({ data: null, error: { message: "Products are unavailable." } }),
          }),
        }),
      }),
    } as unknown as SupplierProductsGateway;

    await expect(loadSupplierProducts("seller-1", gateway)).rejects.toThrow(
      "Products are unavailable.",
    );
  });
});
