import { createFileRoute } from "@tanstack/react-router";
import { RetailerStorefront } from "../../features/retailer/RetailerStorefront.tsx";

export const Route = createFileRoute("/retailer/")({
  component: RetailerStorefront,
});
