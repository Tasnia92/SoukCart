import { supabase } from "../../supabase.ts";

export type SupplierOrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";

export type SupplierOrderItem = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export type SupplierOrder = {
  id: string;
  status: SupplierOrderStatus;
  cancel_requested: boolean;
  payment_status: string;
  payment_method: string;
  notes: string | null;
  created_at: string;
  retailer_name: string;
  retailer_email: string;
  items: SupplierOrderItem[];
  supplier_total: number;
};

type SupplierOrderRow = Omit<SupplierOrder, "supplier_total" | "items" | "cancel_requested"> & {
  supplier_total: number | string;
  cancel_requested: boolean | null;
  items: (Omit<SupplierOrderItem, "unit_price" | "line_total"> & {
    unit_price: number | string;
    line_total: number | string;
  })[];
};

function normalizeOrder(row: SupplierOrderRow): SupplierOrder {
  return {
    ...row,
    status: row.status as SupplierOrderStatus,
    cancel_requested: row.cancel_requested === true,
    supplier_total: Number(row.supplier_total),
    items: (row.items ?? []).map((item) => ({
      ...item,
      unit_price: Number(item.unit_price),
      line_total: Number(item.line_total),
    })),
  };
}

export async function loadSupplierOrders(): Promise<SupplierOrder[]> {
  const { data, error } = await supabase.rpc("supplier_orders");
  if (error) throw new Error(error.message);
  return ((Array.isArray(data) ? data : []) as SupplierOrderRow[]).map(normalizeOrder);
}

export async function setSupplierOrderStatus(
  orderId: string,
  status: "confirmed" | "shipped",
): Promise<SupplierOrderStatus> {
  const { data, error } = await supabase.rpc("seller_set_order_status", {
    p_order_id: orderId,
    p_status: status,
  });
  if (error) throw new Error("The order could not be updated.");
  return (typeof data === "string" ? data : status) as SupplierOrderStatus;
}

export function filterSupplierOrders(
  orders: readonly SupplierOrder[],
  searchTerm: string,
  shortId: (value: string) => string,
): SupplierOrder[] {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return [...orders];
  return orders.filter((order) =>
    [
      shortId(order.id),
      order.retailer_name,
      order.retailer_email,
      order.items.map((item) => item.product_name).join(" "),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}
