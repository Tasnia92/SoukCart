import { Check, Package, Truck } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { StatusBadge, statusLabel, type OrderStatus } from "./order-presentation.tsx";

/**
 * The full order progression, visible to every role:
 * placed → supplier confirmed → admin started delivery →
 * dispatched → out for delivery → delivered.
 * `delivery_initiated` and `out_for_delivery` are not order statuses — they are
 * derived from the admin gate and the parcel state. Suppliers only confirm or
 * cancel; the admin team runs the whole delivery ladder.
 */
export const DELIVERY_STEPS = [
  { id: "pending", label: "Placed", hint: "Order received" },
  { id: "confirmed", label: "Confirmed", hint: "Suppliers confirmed" },
  { id: "delivery_initiated", label: "Delivery initiated", hint: "Admin started it" },
  { id: "shipped", label: "Dispatched", hint: "Left the shop" },
  { id: "out_for_delivery", label: "Out for delivery", hint: "Arriving soon" },
  { id: "delivered", label: "Delivered", hint: "Arrived" },
] as const;

export type DeliveryStepId = (typeof DELIVERY_STEPS)[number]["id"];
export type DeliveryAudience = "admin" | "retailer" | "supplier";

/** Extra context that refines the whole-order status onto the step ladder. */
export type DeliveryProgress = {
  /** Admin pressed "Initiate delivery". */
  deliveryInitiated?: boolean;
  /** Status of the parcel the retailer should look at first. */
  parcelStatus?: string | null;
};

const STEP_INDEX: Record<DeliveryStepId, number> = {
  pending: 0,
  confirmed: 1,
  delivery_initiated: 2,
  shipped: 3,
  out_for_delivery: 4,
  delivered: 5,
};

export function isDeliveryStep(status: string): status is DeliveryStepId {
  return status in STEP_INDEX;
}

/**
 * Position on the 6-step delivery ladder; -1 for cancelled/unknown statuses.
 * Confirmed orders sit on "Confirmed" until admin initiates delivery, and
 * dispatched orders move to "Out for delivery" once a parcel says so.
 */
export function deliveryStepIndex(status: string, progress: DeliveryProgress = {}): number {
  if (!isDeliveryStep(status)) return -1;
  switch (status) {
    case "pending":
      return STEP_INDEX.pending;
    case "confirmed":
      return progress.deliveryInitiated ? STEP_INDEX.delivery_initiated : STEP_INDEX.confirmed;
    case "shipped":
      return progress.parcelStatus === "out_for_delivery"
        ? STEP_INDEX.out_for_delivery
        : STEP_INDEX.shipped;
    case "delivered":
      return STEP_INDEX.delivered;
    default:
      return -1;
  }
}

/** Supplier action labels, keyed by the delivery action the supplier takes. */
export function deliveryActionLabel(action: string): string | null {
  switch (action) {
    case "confirmed":
      return "Confirm order";
    case "dispatched":
      return "Mark dispatched";
    case "out_for_delivery":
      return "Mark out for delivery";
    case "delivered":
      return "Mark delivered";
    default:
      return null;
  }
}

export function deliveryProgressValue(status: string, progress: DeliveryProgress = {}): number {
  const index = deliveryStepIndex(status, progress);
  if (index < 0) return 0;
  return (index / (DELIVERY_STEPS.length - 1)) * 100;
}

export function deliveryStatusCopy(
  status: string,
  audience: DeliveryAudience,
  progress: DeliveryProgress = {},
): string {
  const initiated = progress.deliveryInitiated === true;

  if (status === "cancelled") {
    if (audience === "retailer") return "This order was cancelled.";
    if (audience === "supplier")
      return "This order was cancelled. Any refund is handled for the retailer.";
    return "This order is cancelled.";
  }

  if (audience === "retailer") {
    switch (status) {
      case "pending":
        return "Your order is placed. Each supplier confirms their own items next.";
      case "confirmed":
        return initiated
          ? "Delivery initiated. Your parcels will be dispatched soon."
          : "Confirmed. Delivery starts once admin initiates it.";
      case "shipped":
        return progress.parcelStatus === "out_for_delivery"
          ? "Your order is out for delivery."
          : "Your order has been dispatched.";
      case "delivered":
        return "Delivered. Please confirm you received it.";
      default:
        return `Current status: ${statusLabel(status)}.`;
    }
  }

  if (audience === "supplier") {
    switch (status) {
      case "pending":
        return "Confirm this order, or cancel it. The admin team handles the delivery process.";
      case "confirmed":
        return initiated
          ? "Delivery started. The admin team keeps the delivery status up to date."
          : "Waiting for admin to start the delivery process.";
      case "shipped":
        return progress.parcelStatus === "out_for_delivery"
          ? "Out for delivery. The admin team is bringing the parcel to the retailer."
          : "Dispatched. The admin team is handling delivery.";
      case "delivered":
        return "Delivery is complete.";
      default:
        return `Current status: ${statusLabel(status)}.`;
    }
  }

  switch (status) {
    case "pending":
      return "Waiting for the suppliers to confirm. Suppliers can only confirm or cancel.";
    case "confirmed":
      return initiated
        ? "Delivery started. Keep the delivery status up to date — the order is locked against cancellation."
        : "Confirmed. Start the delivery process once every supplier has confirmed.";
    case "shipped":
      return progress.parcelStatus === "out_for_delivery"
        ? "Out for delivery. Mark it delivered once it arrives."
        : "Dispatched. Keep the delivery status up to date.";
    case "delivered":
      return "Delivery is complete.";
    default:
      return `Current status: ${statusLabel(status)}.`;
  }
}

export function DeliveryStatusCard({
  status,
  audience,
  progress = {},
  nextLabel,
  onNext,
  nextDisabled = false,
  busy = false,
}: {
  status: OrderStatus | string;
  audience: DeliveryAudience;
  progress?: DeliveryProgress;
  nextLabel?: string | null;
  onNext?: () => void;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  const cancelled = status === "cancelled";
  const currentIndex = deliveryStepIndex(status, progress);
  const copy = deliveryStatusCopy(status, audience, progress);
  const actionLabel = nextLabel ?? null;
  const showAction = Boolean(onNext && actionLabel && !cancelled);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Delivery status</CardTitle>
        <CardDescription>{copy}</CardDescription>
        <CardAction>
          <StatusBadge status={status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {cancelled ? (
          <Badge variant="destructive">Cancelled</Badge>
        ) : (
          <>
            <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {DELIVERY_STEPS.map((step, index) => {
                const complete = currentIndex > index;
                const current = currentIndex === index;
                const Icon =
                  step.id === "shipped" || step.id === "out_for_delivery" ? Truck : Package;
                return (
                  <li
                    key={step.id}
                    className="flex min-w-0 flex-col items-center gap-2 text-center"
                  >
                    <span
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full border",
                        complete || current
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-muted text-muted-foreground",
                      )}
                      aria-current={current ? "step" : undefined}
                    >
                      {complete ? (
                        <Check />
                      ) : current ? (
                        <Icon />
                      ) : (
                        <span className="text-xs">{index + 1}</span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "text-xs font-medium",
                        current ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {step.label}
                    </span>
                    <span className="hidden text-[0.7rem] text-muted-foreground sm:block">
                      {step.hint}
                    </span>
                  </li>
                );
              })}
            </ol>
            <Progress
              value={deliveryProgressValue(status, progress)}
              aria-label={`Delivery progress: ${statusLabel(status)}`}
            />
          </>
        )}
      </CardContent>
      {showAction ? (
        <CardFooter>
          <Button type="button" disabled={nextDisabled || busy} onClick={onNext}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {actionLabel}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
