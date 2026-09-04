import { createFileRoute } from "@tanstack/react-router";
import { SupplierEarnings } from "../../features/supplier/SupplierEarnings.tsx";

export const Route = createFileRoute("/supplier/earnings")({
  component: SupplierEarnings,
});
