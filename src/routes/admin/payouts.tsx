import { createFileRoute } from "@tanstack/react-router";
import { AdminPayouts } from "../../features/admin/AdminPayouts.tsx";

export const Route = createFileRoute("/admin/payouts")({
  component: AdminPayouts,
});
