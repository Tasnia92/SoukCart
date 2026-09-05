import { createFileRoute } from "@tanstack/react-router";
import { AdminActivity } from "../../features/admin/AdminActivity.tsx";

export const Route = createFileRoute("/admin/order")({
  component: AdminActivity,
});
