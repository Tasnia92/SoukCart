import { useId, useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { TableCell, TableRow } from "../../components/ui/table";

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
  const ToggleIcon = open ? Minus : Plus;

  return (
    <>
      <TableRow>
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
