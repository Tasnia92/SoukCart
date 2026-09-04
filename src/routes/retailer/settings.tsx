import { createFileRoute } from "@tanstack/react-router";
import { RetailerSettings } from "../../features/retailer/RetailerSettings.tsx";

export const Route = createFileRoute("/retailer/settings")({
  component: RetailerSettings,
});
