import { createFileRoute } from "@tanstack/react-router";
import { SupplierNotifications } from "../../features/supplier/SupplierNotifications.tsx";

export const Route = createFileRoute("/supplier/notifications")({
  component: SupplierNotifications,
});
