import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AdminSupplierVerifications } from "../../features/admin/AdminSupplierVerifications.tsx";

export const Route = createFileRoute("/admin/verifications")({
  component: VerificationsLayout,
});

function VerificationsLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname === "/admin/verifications") {
    return <AdminSupplierVerifications />;
  }
  return <Outlet />;
}
