import { ExternalLink, Package, Truck } from "lucide-react";

import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";

export type OrderTrackingEvent = {
  id: string;
  event_type: string;
  message: string;
  occurred_at: string;
};

export type OrderTrackingShipment = {
  id: string;
  carrier: string;
  tracking_number: string;
  tracking_url: string;
  status: string;
  notes?: string;
  shipped_at: string;
  updated_at?: string;
  provider?: "manual" | "pathao" | string | null;
  consignment_id?: string | null;
  pathao_status?: string | null;
  pathao_delivery_fee?: number | null;
  collected_amount?: number | null;
  events: OrderTrackingEvent[];
};

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

export function OrderTrackingPanel({
  shipment,
  compact = false,
  onRefresh,
  refreshing = false,
}: {
  shipment: OrderTrackingShipment | null | undefined;
  compact?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  if (!shipment) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Package className="size-4 shrink-0" />
          <span>No shipment tracking yet.</span>
        </div>
      </div>
    );
  }

  const isPathao = shipment.provider === "pathao";
  const events = Array.isArray(shipment.events) ? shipment.events : [];

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Truck className="size-4 shrink-0 text-muted-foreground" />
            <p className="font-medium text-foreground">
              {isPathao ? "Pathao" : shipment.carrier}
              {shipment.tracking_number ? ` · ${shipment.tracking_number}` : ""}
            </p>
            <Badge variant="secondary" className="capitalize">
              {statusLabel(shipment.status)}
            </Badge>
            {isPathao ? <Badge variant="outline">Sandbox courier</Badge> : null}
          </div>
          {shipment.pathao_status ? (
            <p className="text-xs text-muted-foreground">
              Courier status: {shipment.pathao_status}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Shipped {formatWhen(shipment.shipped_at)}
            {shipment.updated_at ? ` · Updated ${formatWhen(shipment.updated_at)}` : ""}
          </p>
          {shipment.notes ? (
            <p className="text-xs text-muted-foreground">Notes: {shipment.notes}</p>
          ) : null}
          {isPathao && shipment.collected_amount && shipment.collected_amount > 0 ? (
            <p className="text-xs text-muted-foreground">
              COD amount with Pathao: {shipment.collected_amount.toFixed(2)} BDT
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {shipment.tracking_url ? (
            <Button asChild size="sm" variant="outline">
              <a href={shipment.tracking_url} target="_blank" rel="noreferrer">
                <ExternalLink data-icon="inline-start" />
                {isPathao ? "Track on Pathao" : "Open tracking link"}
              </a>
            </Button>
          ) : null}
          {onRefresh && isPathao ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={refreshing}
              onClick={onRefresh}
            >
              Refresh status
            </Button>
          ) : null}
        </div>
      </div>

      {!compact && events.length ? (
        <ol className="mt-3 space-y-2 border-t border-border/50 pt-3">
          {events.map((event) => (
            <li key={event.id} className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
              <time className="text-xs text-muted-foreground">{formatWhen(event.occurred_at)}</time>
              <div>
                <p className="capitalize text-foreground">{statusLabel(event.event_type)}</p>
                <p className="text-xs text-muted-foreground">{event.message}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {!compact && !events.length ? (
        <p className="mt-3 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          Tracking updates will appear here as the courier moves your parcel.
        </p>
      ) : null}
    </div>
  );
}
