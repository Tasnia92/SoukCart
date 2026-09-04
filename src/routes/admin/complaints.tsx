import { createFileRoute } from "@tanstack/react-router";
import { AdminComplaints } from "../../features/admin/AdminComplaints.tsx";

export const Route = createFileRoute("/admin/complaints")({
  component: AdminComplaints,
});
