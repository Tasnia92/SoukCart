import { supabase } from "../../supabase.ts";

export const SUPPLIER_PRODUCT_COLUMNS =
  "id, name, description, price, unit, stock, category, image_url, is_active, created_at";

export type SupplierProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  stock: number;
  category: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
};

type SupplierProductRecord = Omit<SupplierProduct, "price" | "category"> & {
  price: number | string;
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
  return {
    ...product,
    price: Number(product.price),
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

export type SupplierOverviewStats = {
  total: number;
  active: number;
  outOfStock: number;
  unitsInStock: number;
};

export function getSupplierOverviewStats(
  products: readonly SupplierProduct[],
): SupplierOverviewStats {
  return {
    total: products.length,
    active: products.filter((product) => product.is_active).length,
    outOfStock: products.filter((product) => product.stock <= 0).length,
    unitsInStock: products.reduce((sum, product) => sum + product.stock, 0),
  };
}
