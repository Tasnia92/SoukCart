import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  MessageSquare,
  Package,
  PackageCheck,
  PackageOpen,
  Truck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  DELIVERY_STEPS,
  DeliveryStatusCard,
  deliveryStepIndex,
} from "../orders/DeliveryStatus.tsx";
import { StatusBadge, shortId } from "../orders/order-presentation.tsx";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import {
  packageStatusLabel,
  primaryShipment,
  shipmentStatusLabel,
  type RetailerOrder,
  type RetailerShipment,
} from "./retailer-orders-api.ts";
import type { RetailerShipmentCard } from "./retailer-dashboard-api.ts";
import { formatDate } from "../workspace/format.ts";

/** Maps a supplier-package status onto the 6-step delivery ladder. */
function packageStep(status: string): string {
  switch (status) {
    case "confirmed":
      return "confirmed";
    case "shipped":
      return "shipped";
    case "delivered":
      return "delivered";
    case "declined":
      return "cancelled";
    default:
      return "pending";
  }
}

/**
 * Compact fulfillment ladder: six dots, filled up to the current step, so a
 * row answers "where is it?" without expanding anything.
 */
export function MiniTimeline({
  status,
  deliveryInitiated = false,
  parcelStatus = null,
}: {
  status: string;
  deliveryInitiated?: boolean;
  parcelStatus?: string | null;
}) {
  const cancelled = status === "cancelled";
  const currentIndex = deliveryStepIndex(status, { deliveryInitiated, parcelStatus });
  return (
    <ol
      className="flex items-center gap-1.5"
      aria-label={cancelled ? "Order cancelled" : `Delivery progress: ${status}`}
    >
      {DELIVERY_STEPS.map((step, index) => {
        const reached = !cancelled && (currentIndex > index || currentIndex === index);
        return (
          <li
            key={step.id}
            className={cn(
              "size-2 rounded-full",
              cancelled ? "bg-destructive/70" : reached ? "bg-primary" : "bg-muted-foreground/25",
            )}
            title={step.label}
          />
        );
      })}
    </ol>
  );
}

/** "Placed 3 days ago" wording shared by the strip and the orders table. */
export function placedAgoLabel(ageDays: number): string {
  if (ageDays <= 0) return "Placed today";
  if (ageDays === 1) return "Placed yesterday";
  return `Placed ${ageDays} days ago`;
}

function CopyTrackingButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = () => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? "Tracking number copied" : "Copy tracking number"}
      onClick={onCopy}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

/** Carrier + tracking number with a copy shortcut and, when present, a link. */
export function TrackingLine({
  shipment,
}: {
  shipment: Pick<RetailerShipment, "carrier" | "tracking_number" | "tracking_url">;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
      <span className="text-muted-foreground">{shipment.carrier}</span>
      <span className="font-medium">{shipment.tracking_number}</span>
      <CopyTrackingButton value={shipment.tracking_number} />
      {shipment.tracking_url ? (
        <Button asChild variant="ghost" size="icon-sm">
          <a
            href={shipment.tracking_url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Track this parcel on the ${shipment.carrier} website`}
          >
            <ExternalLink />
          </a>
        </Button>
      ) : null}
    </div>
  );
}

function eventIcon(eventType: string): LucideIcon {
  switch (eventType) {
    case "dispatched":
    case "in_transit":
    case "out_for_delivery":
      return Truck;
    case "delivered":
      return PackageCheck;
    case "exception":
      return TriangleAlert;
    case "note":
      return MessageSquare;
    default:
      return Package;
  }
}

/**
 * One active parcel on the dashboard strip: where it stands, its tracking line,
 * and a Track shortcut into the orders table with the row pre-expanded.
 */
export function ShipmentStripCard({ card }: { card: RetailerShipmentCard }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium">#{shortId(card.orderId)}</CardTitle>
        <CardDescription>
          {placedAgoLabel(card.ageDays)}
          {card.packageCount > 1 ? ` · ${card.packageCount} packages` : ""}
        </CardDescription>
        <CardAction>
          <StatusBadge status={card.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <MiniTimeline status={card.status} parcelStatus={card.shipment?.status ?? null} />
        {card.shipment ? (
          <>
            <TrackingLine
              shipment={{
                carrier: card.shipment.carrier,
                tracking_number: card.shipment.trackingNumber,
                tracking_url: card.shipment.trackingUrl,
              }}
            />
            <p className="text-xs text-muted-foreground">
              {shipmentStatusLabel(card.shipment.status)}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {card.status === "pending"
              ? "Waiting on the supplier to confirm."
              : "Preparing for shipment."}
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <Button asChild variant="outline" size="sm">
          <RouterLink to="/retailer/orders/$orderId" params={{ orderId: card.orderId }}>
            Track
            <ArrowRight data-icon="inline-end" />
          </RouterLink>
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * The expanded tracking view for one order: a stepper per supplier package, the
 * carrier tracking details, and the carrier's event history when a parcel is in
 * flight. Falls back to the order-status explainer when nothing is with a
 * carrier yet.
 */
export function ShipmentTracker({ order }: { order: RetailerOrder }) {
  const shipment = primaryShipment(order);
  const packages = order.packages.length
    ? order.packages
    : [{ supplier_id: "all", status: "pending" as const, decline_reason: null }];
  const multiPackage = order.packages.length > 1;

  if (order.status === "cancelled") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <PackageOpen className="size-4" aria-hidden="true" />
        <span>This order was cancelled.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={cn(multiPackage && "grid gap-3 sm:grid-cols-2")}>
        {packages.map((pkg, index) => (
          <div className="flex items-start gap-3" key={pkg.supplier_id}>
            <div className="pt-1.5">
              <MiniTimeline status={packageStep(pkg.status)} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {multiPackage ? `Package ${index + 1}` : "Package"}
              </p>
              <p
                className={cn(
                  "text-sm",
                  pkg.status === "declined" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {packageStatusLabel(pkg.status)}
                {pkg.decline_reason ? ` · ${pkg.decline_reason}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>

      {shipment ? (
        <Card size="sm">
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Tracking</p>
              <Badge variant={shipment.status === "exception" ? "destructive" : "secondary"}>
                {shipmentStatusLabel(shipment.status)}
              </Badge>
            </div>
            <TrackingLine shipment={shipment} />
            {shipment.shipped_at ? (
              <p className="text-xs text-muted-foreground">
                Handed to {shipment.carrier} on {formatDate(shipment.shipped_at)}
              </p>
            ) : null}
            {shipment.notes ? (
              <p className="text-sm text-muted-foreground">{shipment.notes}</p>
            ) : null}
            {shipment.events.length ? (
              <ol className="mt-1 flex flex-col gap-2 border-t pt-3">
                {shipment.events.map((event) => {
                  const Icon = eventIcon(event.event_type);
                  return (
                    <li className="flex items-start gap-2 text-sm" key={event.id}>
                      <Icon
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p>{event.message}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(event.occurred_at)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <DeliveryStatusCard
          status={order.status}
          audience="retailer"
          progress={{
            deliveryInitiated: Boolean(order.delivery_initiated_at),
            parcelStatus: null,
          }}
        />
      )}
    </div>
  );
}
