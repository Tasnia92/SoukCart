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

export const DELIVERY_STEPS = [
  { id: "pending", label: "Placed", hint: "Order received" },
  { id: "confirmed", label: "Confirmed", hint: "Ready to send" },
  { id: "shipped", label: "Out for delivery", hint: "On the way" },
  { id: "delivered", label: "Delivered", hint: "Arrived" },
] as const;

export type DeliveryStepId = (typeof DELIVERY_STEPS)[number]["id"];
export type DeliveryAudience = "admin" | "retailer" | "supplier";

const STEP_INDEX: Record<DeliveryStepId, number> = {
  pending: 0,
  confirmed: 1,
  shipped: 2,
  delivered: 3,
};

export function isDeliveryStep(status: string): status is DeliveryStepId {
  return status in STEP_INDEX;
}

/** Position on the 4-step delivery ladder; -1 for cancelled/unknown statuses. */
export function deliveryStepIndex(status: string): number {
  return isDeliveryStep(status) ? STEP_INDEX[status] : -1;
}

export function nextDeliveryStatus(status: string): "confirmed" | "shipped" | "delivered" | null {
  switch (status) {
    case "pending":
      return "confirmed";
    case "confirmed":
      return "shipped";
    case "shipped":
      return "delivered";
    default:
      return null;
  }
}

export function nextDeliveryActionLabel(status: string): string | null {
  switch (status) {
    case "pending":
      return "Confirm order";
    case "confirmed":
      return "Mark out for delivery";
    case "shipped":
      return "Mark delivered";
    default:
      return null;
  }
}

export function deliveryProgressValue(status: string): number {
  if (!isDeliveryStep(status)) return 0;
  return (STEP_INDEX[status] / (DELIVERY_STEPS.length - 1)) * 100;
}

export function deliveryStatusCopy(status: string, audience: DeliveryAudience): string {
  if (status === "cancelled") {
    if (audience === "retailer") return "This order was cancelled.";
    if (audience === "supplier") return "This order was cancelled. Admin is handling any refund.";
    return "This order is cancelled.";
  }

  if (audience === "retailer") {
    switch (status) {
      case "pending":
        return "Your order is placed. Each supplier confirms their own items next.";
      case "confirmed":
        return "Confirmed. Your parcels are being prepared and will be out for delivery soon.";
      case "shipped":
        return "Your order is out for delivery.";
      case "delivered":
        return "Delivered. Please confirm you received it.";
      default:
        return `Current status: ${statusLabel(status)}.`;
    }
  }

  if (audience === "supplier") {
    switch (status) {
      case "pending":
        return "Confirm this order, then keep delivery status up to date.";
      case "confirmed":
        return "Mark the parcel out for delivery when it leaves your shop.";
      case "shipped":
        return "Out for delivery. Mark it delivered once the retailer receives it.";
      case "delivered":
        return "You marked this order delivered.";
      default:
        return `Current status: ${statusLabel(status)}.`;
    }
  }

  switch (status) {
    case "pending":
      return "Waiting for the supplier to confirm. Suppliers keep delivery status up to date.";
    case "confirmed":
      return "The supplier marks this out for delivery and delivered. Monitor progress here.";
    case "shipped":
      return "Out for delivery. The supplier marks it delivered once it arrives.";
    case "delivered":
      return "Delivery is complete.";
    default:
      return `Current status: ${statusLabel(status)}.`;
  }
}

export function DeliveryStatusCard({
  status,
  audience,
  nextLabel,
  onNext,
  nextDisabled = false,
  busy = false,
}: {
  status: OrderStatus | string;
  audience: DeliveryAudience;
  nextLabel?: string | null;
  onNext?: () => void;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  const cancelled = status === "cancelled";
  const currentIndex = isDeliveryStep(status) ? STEP_INDEX[status] : -1;
  const copy = deliveryStatusCopy(status, audience);
  const actionLabel = nextLabel ?? nextDeliveryActionLabel(status);
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
            <ol className="grid grid-cols-4 gap-2">
              {DELIVERY_STEPS.map((step, index) => {
                const complete = currentIndex > index;
                const current = currentIndex === index;
                const Icon = step.id === "shipped" ? Truck : Package;
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
              value={deliveryProgressValue(status)}
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
