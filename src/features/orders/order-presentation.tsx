import { useId, useState, type ReactNode } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { TableCell, TableRow } from "../../components/ui/table";
import { Icon } from "../../components/ui/Icon.tsx";

export type OrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";

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

export function shortId(value: string): string {
  return value.replaceAll("-", "").slice(0, 8).toUpperCase();
}

// Semantic tone per lifecycle state — tone reinforces the label, it is never the only cue.
type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case "delivered":
      return "default";
    case "cancelled":
      return "destructive";
    case "pending":
      return "secondary";
    default:
      return "outline";
  }
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>;
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

// Accessible disclosure row: keeps the paired detail-row visual design but toggles
// through a real keyboard-focusable button rather than a clickable <tr>.
export function OrderRow({
  summaryCells,
  detail,
  colSpan,
  toggleLabel,
}: {
  summaryCells: ReactNode;
  detail: ReactNode;
  colSpan: number;
  toggleLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <>
      <TableRow className="rt-order-row">
        {summaryCells}
        <TableCell className="rt-order-toggle">
          <Button
            variant="ghost"
            size="icon"
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={toggleLabel}
            onClick={() => setOpen((previous) => !previous)}
          >
            <Icon name={open ? "minus" : "plus"} />
          </Button>
        </TableCell>
      </TableRow>
      <TableRow className="rt-order-detail" id={detailId} hidden={!open}>
        <TableCell colSpan={colSpan}>
          <div className="rt-order-detail-body">{detail}</div>
        </TableCell>
      </TableRow>
    </>
  );
}
