import { createFileRoute } from "@tanstack/react-router";
import { RetailerTracking } from "../../features/retailer/RetailerTracking.tsx";

export const Route = createFileRoute("/retailer/tracking")({
  component: RetailerTracking,
});
