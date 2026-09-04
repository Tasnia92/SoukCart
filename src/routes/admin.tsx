import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminAuthRoute } from "../components/auth/AuthRoutes.tsx";
import { guardAuthArea } from "../lib/route-guards.ts";
import { useSessionSnapshot } from "../session.tsx";

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ context }) => {
    await guardAuthArea(context.session, "admin");
  },
  component: AdminLayout,
});

function AdminLayout() {
  const { state } = useSessionSnapshot();
  if (state.status !== "admin") return <AdminAuthRoute />;
  return <Outlet />;
}
