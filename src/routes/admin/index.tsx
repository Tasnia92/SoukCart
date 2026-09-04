import { createFileRoute } from "@tanstack/react-router";
import { AdminOverview } from "../../features/admin/AdminOverview.tsx";

export const Route = createFileRoute("/admin/")({
  component: AdminOverview,
});
