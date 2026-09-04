import { createFileRoute } from "@tanstack/react-router";
import { RetailerOverview } from "../../features/retailer/RetailerOverview.tsx";

export const Route = createFileRoute("/retailer/")({
  component: RetailerOverview,
});
