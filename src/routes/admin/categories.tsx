import { createFileRoute } from "@tanstack/react-router";
import { AdminCategories } from "../../features/admin/AdminCategories.tsx";

export const Route = createFileRoute("/admin/categories")({
  component: AdminCategories,
});
