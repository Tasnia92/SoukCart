import { createFileRoute } from "@tanstack/react-router";
import { AdminProducts } from "../../features/admin/AdminProducts.tsx";

export const Route = createFileRoute("/admin/products")({
  component: AdminProducts,
});
