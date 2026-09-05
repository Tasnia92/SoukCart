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
      return "Out for delivery";
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
