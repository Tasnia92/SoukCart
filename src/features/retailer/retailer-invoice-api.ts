import { supabase } from "../../supabase.ts";

export type InvoiceItem = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  product_name: string;
};

export type InvoiceOrder = {
  id: string;
  created_at: string;
  paid_at: string | null;
  payment_method: "online" | "cod";
  tran_id: string | null;
  val_id: string | null;
  bank_tran_id: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  delivery_charge: number;
  items: InvoiceItem[];
};

export type InvoiceResult =
  | { kind: "not-found" }
  | { kind: "unpaid" }
  | { kind: "cancelled" }
  | { kind: "paid"; order: InvoiceOrder };

const INVOICE_SELECT =
  "id, status, cancel_requested, payment_status, payment_method, notes, created_at, paid_at, tran_id, val_id, bank_tran_id, delivery_phone, delivery_address, delivery_city, delivery_postcode, delivery_charge, order_items(id, product_id, quantity, unit_price, products(name))";

type InvoiceItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number | string;
  products: { name: string } | { name: string }[] | null;
};

type InvoiceRow = {
  id: string;
  status: string | null;
  payment_status: string | null;
  payment_method: string | null;
  created_at: string;
  paid_at: string | null;
  tran_id: string | null;
  val_id: string | null;
  bank_tran_id: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  delivery_charge: number | string | null;
  order_items: InvoiceItemRow[] | null;
};

export function invoiceIsAvailable(order: { status: string; payment_status: string }): boolean {
  return order.status !== "cancelled" && order.payment_status === "paid";
}

function productName(relation: InvoiceItemRow["products"]): string {
  if (Array.isArray(relation)) return relation[0]?.name ?? "Unknown product";
  return relation?.name ?? "Unknown product";
}

export async function loadInvoice(orderId: string): Promise<InvoiceResult> {
  const { data, error } = await supabase
    .from("orders")
    .select(INVOICE_SELECT)
    .eq("id", orderId)
    .single();
  const row = data as InvoiceRow | null;
  if (error || !row) return { kind: "not-found" };
  if (row.status === "cancelled") return { kind: "cancelled" };
  if (row.payment_status !== "paid") return { kind: "unpaid" };

  const items: InvoiceItem[] = (row.order_items ?? []).map((item) => ({
    id: item.id,
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price: Number(item.unit_price),
    product_name: productName(item.products),
  }));

  return {
    kind: "paid",
    order: {
      id: row.id,
      created_at: row.created_at,
      paid_at: row.paid_at,
      payment_method: row.payment_method === "cod" ? "cod" : "online",
      tran_id: row.tran_id,
      val_id: row.val_id,
      bank_tran_id: row.bank_tran_id,
      delivery_phone: row.delivery_phone ?? null,
      delivery_address: row.delivery_address ?? null,
      delivery_city: row.delivery_city ?? null,
      delivery_postcode: row.delivery_postcode ?? null,
      delivery_charge: Number(row.delivery_charge ?? 0),
      items,
    },
  };
}

export function invoiceMerchandiseTotal(order: InvoiceOrder): number {
  return order.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
}

export function invoiceTotal(order: InvoiceOrder): number {
  return invoiceMerchandiseTotal(order) + Number(order.delivery_charge ?? 0);
}
