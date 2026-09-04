import { createFileRoute } from "@tanstack/react-router";
import { SupplierStock } from "../../features/supplier/SupplierStock.tsx";

export const Route = createFileRoute("/supplier/stock")({
  component: SupplierStock,
});
