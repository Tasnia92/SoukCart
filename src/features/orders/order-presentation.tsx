import { useId, useState, type ReactNode } from "react";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { TableCell, TableRow } from "../../components/ui/table";

export type OrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";

export const ORDER_STATUS_TABS = ["all", "pending", "shipped", "delivered", "cancelled"] as const;

export type OrderStatusTab = (typeof ORDER_STATUS_TABS)[number];

export function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "confirmed":
      return "Confirmed";
    case "shipped":
      return "Shipped";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

/** Pending tab includes confirmed orders that have not shipped yet. */
export function statusTabOf(status: string): Exclude<OrderStatusTab, "all"> {
  if (status === "shipped") return "shipped";
  if (status === "delivered") return "delivered";
  if (status === "cancelled") return "cancelled";
  return "pending";
}

export function matchesStatusTab(status: string, tab: OrderStatusTab): boolean {
  if (tab === "all") return true;
  return statusTabOf(status) === tab;
}

export function orderTypeOf(order: {
  status: string;
  refund_amount?: number;
  manual_refund_status?: string | null;
}): "sale" | "refund" {
  if (order.status === "cancelled") return "refund";
  if ((order.refund_amount ?? 0) > 0) return "refund";
  if (order.manual_refund_status && order.manual_refund_status !== "not_required") return "refund";
  return "sale";
}

export function shortId(value: string): string {
  return value.replaceAll("-", "").slice(0, 8).toUpperCase();
}

const STATUS_TONE: Record<string, string> = {
  pending: "border-status-pending/35 bg-status-pending/10 text-status-pending",
  confirmed: "border-status-pending/35 bg-status-pending/10 text-status-pending",
  shipped: "border-status-shipped/35 bg-status-shipped/10 text-status-shipped",
  delivered: "border-status-delivered/35 bg-status-delivered/10 text-status-delivered",
  cancelled: "border-status-cancelled/35 bg-status-cancelled/10 text-status-cancelled",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={STATUS_TONE[status]}>
      {statusLabel(status)}
    </Badge>
  );
}

export function OrderProductThumb({ src }: { src?: string | null }) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(src) && !broken;

  return (
    <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-muted">
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="flex size-full items-center justify-center text-muted-foreground [&_svg]:size-4">
          <ShoppingBag />
        </span>
      )}
    </div>
  );
}

export function OrderProductCell({
  name,
  imageUrl,
  extraCount = 0,
}: {
  name: string;
  imageUrl?: string | null;
  extraCount?: number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <OrderProductThumb src={imageUrl} />
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        {extraCount > 0 ? (
          <p className="text-xs text-muted-foreground">+{extraCount} more</p>
        ) : null}
      </div>
    </div>
  );
}

export function OrderCustomerCell({ name, email }: { name: string; email?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{name}</p>
      {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
    </div>
  );
}

export function primaryProductName(
  items: readonly { product_name: string }[],
  fallback = "Order",
): { name: string; extraCount: number } {
  const first = items[0];
  return {
    name: first?.product_name ?? fallback,
    extraCount: Math.max(items.length - 1, 0),
  };
}

export function DeliveryDetails({
  phone,
  address,
  city,
  postcode,
}: {
  phone: string | null;
  address: string | null;
  city: string | null;
  postcode: string | null;
}) {
  const line = [address, city, postcode].filter(Boolean).join(", ");
  if (!line && !phone) return null;
  return (
    <p className="text-sm">
      <span className="font-medium">Deliver to: </span>
      {line || "Address not provided"}
      {phone ? ` · ${phone}` : ""}
    </p>
  );
}

export function PaymentBadge({
  paymentStatus,
  paymentMethod,
  showFailed = false,
}: {
  paymentStatus: string;
  paymentMethod: string;
  showFailed?: boolean;
}) {
  if (paymentStatus === "paid") return <Badge variant="default">Paid</Badge>;
  if (paymentMethod === "cod") return <Badge variant="secondary">COD</Badge>;
  if (showFailed && paymentStatus === "failed") return <Badge variant="outline">Failed</Badge>;
  return null;
}

export function OrderRow({
  summaryCells,
  detail,
  colSpan,
  toggleLabel,
  defaultOpen = false,
  highlight = false,
  rowId,
}: {
  summaryCells: ReactNode;
  detail: ReactNode;
  colSpan: number;
  toggleLabel: string;
  defaultOpen?: boolean;
  highlight?: boolean;
  rowId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const detailId = useId();
  const ToggleIcon = open ? Minus : Plus;

  return (
    <>
      <TableRow id={rowId} data-state={highlight ? "selected" : undefined}>
        {summaryCells}
        <TableCell className="w-12 text-right">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={toggleLabel}
            onClick={() => setOpen((previous) => !previous)}
          >
            <ToggleIcon />
          </Button>
        </TableCell>
      </TableRow>
      <TableRow id={detailId} hidden={!open}>
        <TableCell colSpan={colSpan} className="p-0">
          <div className="m-3 flex flex-col gap-3 rounded-xl bg-muted/50 p-4">{detail}</div>
        </TableCell>
      </TableRow>
    </>
  );
}
