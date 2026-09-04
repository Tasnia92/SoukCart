import { createFileRoute } from "@tanstack/react-router";
import { SupplierCustomers } from "../../features/supplier/SupplierCustomers.tsx";

export const Route = createFileRoute("/supplier/customers")({
  component: SupplierCustomers,
});
