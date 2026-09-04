import { createFileRoute } from "@tanstack/react-router";
import { AdminSupplierVerificationDetail } from "../../features/admin/AdminSupplierVerificationDetail.tsx";

export const Route = createFileRoute("/admin/verifications/$userId")({
  component: AdminVerificationDetailPage,
});

function AdminVerificationDetailPage() {
  const { userId } = Route.useParams();
  return <AdminSupplierVerificationDetail userId={userId} />;
}
