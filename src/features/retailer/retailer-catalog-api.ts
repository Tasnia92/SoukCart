import { supabase } from "../../supabase.ts";

export type RetailerProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  stock: number;
  category: string | null;
  image_url: string | null;
  seller_name: string | null;
};

const PRODUCTS_SELECT =
  "id, name, description, price, unit, stock, category, image_url, users(name)";

type ProductRow = {
  id: string;
  name: string;
  description: string;
  price: number | string;
  unit: string;
  stock: number;
  category: string | null;
  image_url: string | null;
  users: { name: string } | { name: string }[] | null;
};

function sellerName(relation: ProductRow["users"]): string | null {
  if (Array.isArray(relation)) return relation[0]?.name ?? null;
  return relation?.name ?? null;
}

function normalize(row: ProductRow): RetailerProduct {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    unit: row.unit,
    stock: row.stock,
    category: row.category ?? null,
    image_url: row.image_url,
    seller_name: sellerName(row.users),
  };
}

export async function loadActiveProducts(): Promise<RetailerProduct[]> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCTS_SELECT)
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as ProductRow[]).map(normalize);
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
  product: Pick<RetailerProduct, "name" | "stock">,
  inCart: number,
  requested: number,
): number {
  const wanted = inCart + requested;
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
