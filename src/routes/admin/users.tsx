import { createFileRoute } from "@tanstack/react-router";
import { AdminUsers } from "../../features/admin/AdminUsers.tsx";

export const Route = createFileRoute("/admin/users")({
  component: AdminUsers,
});
