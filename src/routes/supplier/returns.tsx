import { createFileRoute } from "@tanstack/react-router";
import { SupplierReturns } from "../../features/supplier/SupplierReturns.tsx";

export const Route = createFileRoute("/supplier/returns")({
  component: SupplierReturns,
});
