import { createFileRoute } from "@tanstack/react-router";
import { SupplierOrders } from "../../features/supplier/SupplierOrders.tsx";

export const Route = createFileRoute("/supplier/orders")({
  component: SupplierOrders,
});
