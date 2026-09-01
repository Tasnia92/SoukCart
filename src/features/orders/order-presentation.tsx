import { useId, useState, type ReactNode } from "react";
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

export function StatusBadge({ status }: { status: string }) {
  return <span className={`rt-status rt-status-${status}`}>{statusLabel(status)}</span>;
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
  if (paymentStatus === "paid") return <span className="rt-pay-badge">Paid</span>;
  if (paymentMethod === "cod") return <span className="rt-pay-badge is-cod">COD</span>;
  if (showFailed && paymentStatus === "failed") return <span className="admin-muted">Failed</span>;
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
      <tr className="rt-order-row">
        {summaryCells}
        <td className="rt-order-toggle">
          <button
            type="button"
            className="rt-order-toggle-button"
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={toggleLabel}
            onClick={() => setOpen((previous) => !previous)}
          >
            <Icon name={open ? "minus" : "plus"} />
          </button>
        </td>
      </tr>
      <tr className="rt-order-detail" id={detailId} hidden={!open}>
        <td colSpan={colSpan}>
          <div className="rt-order-detail-body">{detail}</div>
        </td>
      </tr>
    </>
  );
}
