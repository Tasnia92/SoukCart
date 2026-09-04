import { createFileRoute } from "@tanstack/react-router";
import { CheckoutResult } from "../../features/retailer/CheckoutResult.tsx";

export const Route = createFileRoute("/retailer/checkout/success")({
  component: CheckoutResult,
});
