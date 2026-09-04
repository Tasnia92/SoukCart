import { createFileRoute } from "@tanstack/react-router";
import { RetailerNotifications } from "../../features/retailer/RetailerNotifications.tsx";

export const Route = createFileRoute("/retailer/notifications")({
  component: RetailerNotifications,
});
