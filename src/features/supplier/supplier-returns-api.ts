import { supabase } from "../../supabase.ts";

export type SellerReturnStatus =
  | "requested"
  | "approved"
  | "rejected"
  | "received"
  | "refunded"
  | "closed";

export type SellerReturnItem = {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export type SellerReturn = {
  id: string;
  order_id: string;
  status: SellerReturnStatus;
  reason: string;
  seller_note: string;
  refund_amount: number;
  requested_at: string;
  resolved_at: string | null;
  updated_at: string;
  requested_by: string;
  retailer_name: string;
  retailer_email: string;
  supplier_total: number;
  items: SellerReturnItem[];
};

export type SellerReturnAction = {
  status: Exclude<SellerReturnStatus, "requested">;
  label: string;
};

export type SellerReturnStatusUpdate = {
  id: string;
  orderId: string;
  status: SellerReturnStatus;
  reason: string;
  sellerNote: string;
  refundAmount: number;
  requestedAt: string;
  resolvedAt: string | null;
  updatedAt: string;
};

export type SellerReturnRequestResult = {
  id: string;
  orderId: string;
  status: SellerReturnStatus;
  reason: string;
  refundAmount: number;
  requestedAt: string;
};

const OPEN_RETURN_STATUSES: readonly SellerReturnStatus[] = [
  "requested",
  "approved",
  "received",
  "refunded",
];

const RETURN_STATUSES: readonly SellerReturnStatus[] = [
  "requested",
  "approved",
  "rejected",
  "received",
  "refunded",
  "closed",
];

function asMoney(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function asInt(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.trunc(amount) : 0;
}

function asStatus(value: unknown): SellerReturnStatus {
  return RETURN_STATUSES.includes(value as SellerReturnStatus)
    ? (value as SellerReturnStatus)
    : "requested";
}

function normalizeReturnItem(value: unknown): SellerReturnItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) return null;
  return {
    id: row.id,
    product_name: typeof row.product_name === "string" ? row.product_name : "Item",
    quantity: asInt(row.quantity),
    unit_price: asMoney(row.unit_price),
    line_total: asMoney(row.line_total),
  };
}

/** Pure parser for a `seller_returns` row — coerces numeric fields. */
export function normalizeSellerReturn(value: unknown): SellerReturn | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) return null;
  if (typeof row.order_id !== "string" || !row.order_id) return null;

  const items = Array.isArray(row.items)
    ? row.items.map(normalizeReturnItem).filter((item): item is SellerReturnItem => item !== null)
    : [];

  return {
    id: row.id,
    order_id: row.order_id,
    status: asStatus(row.status),
    reason: typeof row.reason === "string" ? row.reason : "",
    seller_note: typeof row.seller_note === "string" ? row.seller_note : "",
    refund_amount: asMoney(row.refund_amount),
    requested_at: typeof row.requested_at === "string" ? row.requested_at : "",
    resolved_at: typeof row.resolved_at === "string" ? row.resolved_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
    requested_by: typeof row.requested_by === "string" ? row.requested_by : "",
    retailer_name: typeof row.retailer_name === "string" ? row.retailer_name : "Retailer",
    retailer_email: typeof row.retailer_email === "string" ? row.retailer_email : "",
    supplier_total: asMoney(row.supplier_total),
    items,
  };
}

export function normalizeSellerReturns(data: unknown): SellerReturn[] {
  if (!Array.isArray(data)) return [];
  return data.map(normalizeSellerReturn).filter((entry): entry is SellerReturn => entry !== null);
}

export function isOpenReturnStatus(status: SellerReturnStatus): boolean {
  return OPEN_RETURN_STATUSES.includes(status);
}

/** Allowed next statuses for the seller workflow, with button labels. */
export function nextReturnActions(status: SellerReturnStatus): SellerReturnAction[] {
  switch (status) {
    case "requested":
      return [
        { status: "approved", label: "Approve" },
        { status: "rejected", label: "Reject" },
      ];
    case "approved":
      return [
        { status: "received", label: "Mark received" },
        { status: "rejected", label: "Reject" },
        { status: "closed", label: "Close" },
      ];
    case "received":
      return [
        { status: "refunded", label: "Record refund" },
        { status: "closed", label: "Close" },
      ];
    case "refunded":
      return [{ status: "closed", label: "Close" }];
    default:
      return [];
  }
}

export function returnStatusLabel(status: SellerReturnStatus): string {
  switch (status) {
    case "requested":
      return "Requested";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "received":
      return "Received";
    case "refunded":
      return "Refunded";
    case "closed":
      return "Closed";
  }
}

function normalizeStatusUpdate(data: unknown): SellerReturnStatusUpdate {
  if (!data || typeof data !== "object") {
    throw new Error("Return status response was empty.");
  }
  const row = data as Record<string, unknown>;
  return {
    id: typeof row.id === "string" ? row.id : "",
    orderId: typeof row.orderId === "string" ? row.orderId : "",
    status: asStatus(row.status),
    reason: typeof row.reason === "string" ? row.reason : "",
    sellerNote: typeof row.sellerNote === "string" ? row.sellerNote : "",
    refundAmount: asMoney(row.refundAmount),
    requestedAt: typeof row.requestedAt === "string" ? row.requestedAt : "",
    resolvedAt: typeof row.resolvedAt === "string" ? row.resolvedAt : null,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
  };
}

function normalizeRequestResult(data: unknown): SellerReturnRequestResult {
  if (!data || typeof data !== "object") {
    throw new Error("Return request response was empty.");
  }
  const row = data as Record<string, unknown>;
  return {
    id: typeof row.id === "string" ? row.id : "",
    orderId: typeof row.orderId === "string" ? row.orderId : "",
    status: asStatus(row.status),
    reason: typeof row.reason === "string" ? row.reason : "",
    refundAmount: asMoney(row.refundAmount),
    requestedAt: typeof row.requestedAt === "string" ? row.requestedAt : "",
  };
}

export async function loadSellerReturns(): Promise<SellerReturn[]> {
  const { data, error } = await supabase.rpc("seller_returns");
  if (error) throw new Error(error.message);
  return normalizeSellerReturns(data);
}

export async function requestSellerReturn(
  orderId: string,
  reason: string,
): Promise<SellerReturnRequestResult> {
  const { data, error } = await supabase.rpc("seller_request_return", {
    p_order_id: orderId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return normalizeRequestResult(data);
}

export async function setSellerReturnStatus(
  returnId: string,
  status: Exclude<SellerReturnStatus, "requested">,
  sellerNote?: string,
  refundAmount?: number,
): Promise<SellerReturnStatusUpdate> {
  const { data, error } = await supabase.rpc("seller_set_return_status", {
    p_return_id: returnId,
    p_status: status,
    p_seller_note: sellerNote ?? "",
    p_refund_amount: refundAmount ?? null,
  });
  if (error) throw new Error(error.message);
  return normalizeStatusUpdate(data);
}
