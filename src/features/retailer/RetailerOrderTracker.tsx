import type { ReactNode } from "react";
import { Ban, Check, House, Truck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatDate, formatPrice, formatTrackStamp } from "../workspace/format.ts";
import { DeliveryDetails, StatusBadge, shortId } from "../orders/order-presentation.tsx";
import {
  packageStatusLabel,
  primaryShipment,
  shipmentStatusLabel,
  type RetailerOrder,
} from "./retailer-orders-api.ts";
import { TrackingLine } from "./Shipments.tsx";

const TRACK_STEPS = [
  { id: "placed", label: "Order Placed" },
  { id: "processing", label: "Processing" },
  { id: "shipped", label: "Shipped" },
  { id: "delivered", label: "Delivered" },
] as const;

function stepIndex(order: RetailerOrder): number {
  if (order.status === "cancelled") return -1;
  if (order.status === "delivered") return 3;
  if (order.status === "shipped") return 2;
  if (order.status === "confirmed" || order.delivery_initiated_at) return 1;
  return 0;
}

function stepTimes(order: RetailerOrder): (string | null)[] {
  const shipment = primaryShipment(order);
  const deliveredEvent = shipment?.events.find((event) => event.event_type === "delivered");
  return [
    order.created_at,
    order.delivery_initiated_at,
    shipment?.shipped_at || null,
    order.delivery_verified_at || deliveredEvent?.occurred_at || null,
  ];
}

function headline(order: RetailerOrder): string {
  if (order.status === "cancelled") return "This order was cancelled";
  return "Thank you for your order!";
}

function statusCopy(order: RetailerOrder): string {
  const shipment = primaryShipment(order);
  if (order.status === "cancelled") {
    if (order.manual_refund_status === "pending") {
      return `A refund of ${formatPrice(order.refund_amount)} is pending.`;
    }
    if (order.manual_refund_status === "completed") {
      return `Refund of ${formatPrice(order.refund_amount)} is completed.`;
    }
    if (order.manual_refund_status === "review_required") {
      return "A historical refund needs admin review.";
    }
    return "This order will not be delivered.";
  }
  if (order.cancel_requested) {
    return "Cancellation requested. Waiting for the suppliers to approve.";
  }
  if (order.status === "delivered") return "Order delivered!";
  if (order.status === "shipped") {
    return shipment?.status === "out_for_delivery"
      ? "Your order is out for delivery."
      : "Your order has been shipped.";
  }
  if (order.delivery_initiated_at) return "Delivery has started. Your parcel will ship soon.";
  if (order.status === "confirmed")
    return "Suppliers confirmed your items. We're preparing the order.";
  return "We've received your order. Each supplier confirms their items next.";
}

function deliveryLine(order: RetailerOrder): string {
  return [order.delivery_address, order.delivery_city, order.delivery_postcode]
    .filter(Boolean)
    .join(", ");
}

export function RetailerOrderStatusView({
  order,
  actions,
}: {
  order: RetailerOrder;
  actions?: ReactNode;
}) {
  const cancelled = order.status === "cancelled";
  const current = stepIndex(order);
  const times = stepTimes(order);
  const progress = current < 0 ? 0 : (current / (TRACK_STEPS.length - 1)) * 100;
  const shipment = primaryShipment(order);
  const delivered = order.status === "delivered";
  const itemsTotal = order.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className={cn(
            "flex size-16 items-center justify-center rounded-full",
            cancelled
              ? "bg-status-cancelled/15 text-status-cancelled"
              : "bg-status-delivered/15 text-status-delivered",
          )}
        >
          {cancelled ? <Ban /> : <Check />}
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            {headline(order)}
          </h1>
          <p className="text-sm text-muted-foreground">
            Order #{shortId(order.id)} · {formatDate(order.created_at)}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Order Status</CardTitle>
          <CardDescription>{statusCopy(order)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {cancelled ? (
            <Badge variant="destructive">Cancelled</Badge>
          ) : (
            <>
              <Progress
                value={progress}
                aria-label={`Order progress: ${statusCopy(order)}`}
                className="*:data-[slot=progress-indicator]:bg-status-delivered"
              />
              <ol className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {TRACK_STEPS.map((step, index) => {
                  const complete = current > index;
                  const currentStep = current === index;
                  const reached = complete || currentStep;
                  return (
                    <li
                      key={step.id}
                      className="flex min-w-0 flex-col items-center gap-2 text-center"
                    >
                      <span
                        className={cn(
                          "flex size-10 items-center justify-center rounded-full border",
                          reached
                            ? "border-status-delivered bg-status-delivered text-background"
                            : "border-border bg-muted text-muted-foreground",
                        )}
                        aria-current={currentStep ? "step" : undefined}
                      >
                        {complete ? <Check /> : <span className="text-sm">{index + 1}</span>}
                      </span>
                      <span
                        className={cn(
                          "text-sm font-medium",
                          currentStep ? "text-status-delivered" : "text-foreground",
                        )}
                      >
                        {step.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {times[index] ? formatTrackStamp(times[index] as string) : "—"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}

          {delivered ? (
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span className="flex size-8 items-center justify-center rounded-full bg-status-delivered/15 text-status-delivered">
                    <House />
                  </span>
                  Successfully Delivered
                </CardTitle>
                <CardDescription>
                  {order.delivery_verified_at
                    ? formatTrackStamp(order.delivery_verified_at)
                    : "Your package has been delivered."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <dt className="text-xs text-muted-foreground">Delivered To</dt>
                    <dd className="text-sm font-medium">
                      {deliveryLine(order) || "Address on file"}
                    </dd>
                  </div>
                  {order.delivery_phone ? (
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">Phone</dt>
                      <dd className="text-sm font-medium">{order.delivery_phone}</dd>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <dt className="text-xs text-muted-foreground">Delivery Time</dt>
                    <dd className="text-sm font-medium">
                      {order.delivery_verified_at
                        ? formatTrackStamp(order.delivery_verified_at)
                        : times[3]
                          ? formatTrackStamp(times[3] as string)
                          : "Confirmed delivered"}
                    </dd>
                  </div>
                  {shipment?.tracking_number ? (
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-muted-foreground">Tracking</dt>
                      <dd className="text-sm font-medium">
                        {shipment.carrier} · {shipment.tracking_number}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {!delivered && !cancelled && shipment ? (
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Truck />
                  Tracking
                </CardTitle>
                <CardDescription>{shipmentStatusLabel(shipment.status)}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <TrackingLine shipment={shipment} />
                {shipment.shipped_at ? (
                  <p className="text-xs text-muted-foreground">
                    Handed over {formatTrackStamp(shipment.shipped_at)}
                  </p>
                ) : null}
                {shipment.events.length ? (
                  <ol className="flex flex-col gap-2 border-t pt-3">
                    {shipment.events.map((event) => (
                      <li className="flex flex-col gap-0.5 text-sm" key={event.id}>
                        <span>{event.message}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(event.occurred_at)}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {order.cancel_requested && order.status !== "cancelled" ? (
            <Alert>
              <AlertTitle>Cancellation requested</AlertTitle>
              <AlertDescription>
                Waiting for the suppliers on this order to approve or reject the request.
              </AlertDescription>
            </Alert>
          ) : null}

          {order.notes ? (
            <Alert>
              <AlertTitle>Order notes</AlertTitle>
              <AlertDescription>{order.notes}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Items</CardTitle>
            <StatusBadge status={order.status} />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {order.items.map((item) => (
            <div className="flex items-center justify-between gap-4 text-sm" key={item.id}>
              <span className="min-w-0 truncate font-medium">{item.product_name}</span>
              <span className="shrink-0 text-muted-foreground">
                {item.quantity} × {formatPrice(item.unit_price)}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatPrice(item.unit_price * item.quantity)}
              </span>
            </div>
          ))}
          <Separator />
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatPrice(itemsTotal)}</span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Delivery</span>
            <span className="tabular-nums">{formatPrice(order.delivery_charge)}</span>
          </div>
          <div className="flex justify-between gap-4 text-sm font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatPrice(itemsTotal + order.delivery_charge)}</span>
          </div>
          {order.payment_method === "cod" ? (
            <>
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Delivery payment</span>
                <span>
                  {order.delivery_payment_status === "paid"
                    ? "Paid online"
                    : order.delivery_payment_status === "failed"
                      ? "Failed"
                      : order.delivery_payment_status === "cancelled"
                        ? "Cancelled"
                        : "Unpaid"}
                </span>
              </div>
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Products</span>
                <span>
                  {order.payment_status === "paid" ? "Cash collected" : "Pay in cash on arrival"}
                </span>
              </div>
            </>
          ) : null}
          {order.packages.some((pkg) => pkg.status === "declined") ? (
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {order.packages
                .filter((pkg) => pkg.status === "declined")
                .map((pkg) => (
                  <li key={pkg.supplier_id}>
                    {packageStatusLabel(pkg.status)}
                    {pkg.decline_reason ? ` · ${pkg.decline_reason}` : ""}
                  </li>
                ))}
            </ul>
          ) : null}
          <DeliveryDetails
            phone={order.delivery_phone}
            address={order.delivery_address}
            city={order.delivery_city}
            postcode={order.delivery_postcode}
          />
        </CardContent>
      </Card>

      {actions ? (
        <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
