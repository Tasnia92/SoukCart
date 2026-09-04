import { createFileRoute } from "@tanstack/react-router";
import { SupplierOverview } from "../../features/supplier/SupplierOverview.tsx";

export const Route = createFileRoute("/supplier/")({
  component: SupplierOverview,
});
