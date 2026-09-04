import { supabase } from "../../supabase.ts";

export type RetailerProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  stock: number;
  min_order_qty: number;
  category: string | null;
  image_url: string | null;
  seller_id: string | null;
  seller_name: string | null;
};

const CATALOG_TABLE = "catalog_products";
const PRODUCTS_SELECT =
  "id, name, description, price, unit, stock, min_order_qty, category, image_url, seller_id, seller_name";

type ProductRow = {
  id: string;
  name: string;
  description: string;
  price: number | string;
  unit: string;
  stock: number;
  min_order_qty: number | string | null;
  category: string | null;
  image_url: string | null;
  seller_id: string | null;
  seller_name: string | null;
};

function minOrderQty(value: ProductRow["min_order_qty"]): number {
  const qty = Number(value);
  return Number.isInteger(qty) && qty >= 1 ? qty : 1;
}

function normalize(row: ProductRow): RetailerProduct {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    unit: row.unit,
    stock: row.stock,
    min_order_qty: minOrderQty(row.min_order_qty),
    category: row.category ?? null,
    image_url: row.image_url,
    seller_id: row.seller_id ?? null,
    seller_name: row.seller_name ?? null,
  };
}

export function cartSupplierConflict(
  product: Pick<RetailerProduct, "seller_id" | "seller_name">,
  cartProducts: readonly Pick<RetailerProduct, "seller_id" | "seller_name">[],
): string | null {
  const other = cartProducts.find(
    (item) => item.seller_id && product.seller_id && item.seller_id !== product.seller_id,
  );
  if (!other) return null;
  return `Your cart is from ${other.seller_name ?? "another supplier"}. Checkout one supplier at a time.`;
}

export async function loadRetailerProducts(): Promise<RetailerProduct[]> {
  const { data, error } = await supabase.from(CATALOG_TABLE).select(PRODUCTS_SELECT).order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as ProductRow[]).map(normalize);
}

/** Catalog listings: approved suppliers (RLS) and enough stock to meet MOQ. */
export async function loadActiveProducts(): Promise<RetailerProduct[]> {
  return (await loadRetailerProducts()).filter((product) => product.stock >= product.min_order_qty);
}

export async function loadCartQuantities(userId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("cart_items")
    .select("product_id, quantity")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { product_id: string; quantity: number }[]).reduce<
    Record<string, number>
  >((acc, row) => {
    acc[row.product_id] = row.quantity;
    return acc;
  }, {});
}

export async function upsertCartItem(
  userId: string,
  productId: string,
  quantity: number,
): Promise<void> {
  const { error } = await supabase
    .from("cart_items")
    .upsert(
      { user_id: userId, product_id: productId, quantity },
      { onConflict: "user_id,product_id" },
    );
  if (error) throw new Error(error.message);
}

export function filterProducts(
  products: readonly RetailerProduct[],
  searchTerm: string,
  selectedCategory: string | null,
): RetailerProduct[] {
  const query = searchTerm.trim().toLowerCase();
  return products.filter((product) => {
    if (selectedCategory && product.category !== selectedCategory) return false;
    if (!query) return true;
    return [product.name, product.description, product.seller_name ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

export type CategoryCount = { category: string; count: number };

export function getCategoryCounts(products: readonly RetailerProduct[]): CategoryCount[] {
  const categories = Array.from(
    new Set(
      products
        .map((product) => product.category)
        .filter((category): category is string => Boolean(category)),
    ),
  ).sort((a, b) => a.localeCompare(b));
  return categories.map((category) => ({
    category,
    count: products.filter((product) => product.category === category).length,
  }));
}

// Resolves the total quantity to persist, throwing the legacy stock messages when the
// requested addition would exceed available stock.
export function nextCartQuantity(
  product: Pick<RetailerProduct, "name" | "stock" | "min_order_qty">,
  inCart: number,
  requested: number,
): number {
  const minQty = Math.max(1, product.min_order_qty || 1);
  const wanted = inCart === 0 ? Math.max(minQty, requested) : inCart + requested;
  if (wanted > product.stock) {
    const remaining = product.stock - inCart;
    if (remaining <= 0) {
      throw new Error(
        `You already have all ${product.stock} unit${product.stock === 1 ? "" : "s"} of ${product.name} in your order.`,
      );
    }
    throw new Error(
      `Only ${remaining} more unit${remaining === 1 ? "" : "s"} of ${product.name} are in stock.`,
    );
  }
  return wanted;
}
