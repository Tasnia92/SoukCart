import { createFileRoute } from "@tanstack/react-router";
import { SupplierProductForm } from "../../features/supplier/SupplierProductForm.tsx";

export const Route = createFileRoute("/supplier/products/new")({
  component: SupplierProductForm,
});
