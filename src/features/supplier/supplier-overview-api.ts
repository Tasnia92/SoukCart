import { supabase } from "../../supabase.ts";

export const SUPPLIER_PRODUCT_COLUMNS =
  "id, name, description, price, unit, stock, min_order_qty, category, image_url, is_active, created_at";

export type SupplierProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  stock: number;
  min_order_qty: number;
  category: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
};

type SupplierProductRecord = Omit<SupplierProduct, "price" | "category" | "min_order_qty"> & {
  price: number | string;
  min_order_qty: number | string | null;
  category: string | null;
};

type SupplierProductsQuery = {
  eq: (column: string, value: string) => SupplierProductsQuery;
  order: (
    column: string,
    options: { ascending: boolean },
  ) => Promise<{ data: SupplierProductRecord[] | null; error: { message: string } | null }>;
};

export type SupplierProductsGateway = {
  from: (table: "products") => {
    select: (columns: string) => SupplierProductsQuery;
  };
};

const supplierGateway = supabase as unknown as SupplierProductsGateway;

export function normalizeSupplierProduct(product: SupplierProductRecord): SupplierProduct {
  const minQty = Number(product.min_order_qty);
  return {
    ...product,
    price: Number(product.price),
    min_order_qty: Number.isInteger(minQty) && minQty >= 1 ? minQty : 1,
    category: product.category ?? null,
  };
}

export async function loadSupplierProducts(
  sellerId: string,
  gateway: SupplierProductsGateway = supplierGateway,
): Promise<SupplierProduct[]> {
  const { data, error } = await gateway
    .from("products")
    .select(SUPPLIER_PRODUCT_COLUMNS)
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(normalizeSupplierProduct);
}

// Catalog totals now come from `buildSupplierDashboard`, which weighs them against
// incoming orders and stock risk instead of reporting the catalog in isolation.
