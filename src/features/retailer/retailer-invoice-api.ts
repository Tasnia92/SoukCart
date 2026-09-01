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
  tran_id: string | null;
  val_id: string | null;
  bank_tran_id: string | null;
  items: InvoiceItem[];
};

export type InvoiceResult =
  | { kind: "not-found" }
  | { kind: "unpaid" }
  | { kind: "paid"; order: InvoiceOrder };

const INVOICE_SELECT =
  "id, status, cancel_requested, payment_status, payment_method, notes, created_at, paid_at, tran_id, val_id, bank_tran_id, order_items(id, product_id, quantity, unit_price, products(name))";

type InvoiceItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number | string;
  products: { name: string } | { name: string }[] | null;
};

type InvoiceRow = {
  id: string;
  payment_status: string | null;
  created_at: string;
  paid_at: string | null;
  tran_id: string | null;
  val_id: string | null;
  bank_tran_id: string | null;
  order_items: InvoiceItemRow[] | null;
};

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
      tran_id: row.tran_id,
      val_id: row.val_id,
      bank_tran_id: row.bank_tran_id,
      items,
    },
  };
}

export function invoiceTotal(order: InvoiceOrder): number {
  return order.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
}
