import { createFileRoute } from "@tanstack/react-router";
import { SupplierSettings } from "../../features/supplier/SupplierSettings.tsx";

export const Route = createFileRoute("/supplier/settings")({
  component: SupplierSettings,
});
