import { createFileRoute } from "@tanstack/react-router";
import { SupplierProductForm } from "../../features/supplier/SupplierProductForm.tsx";

export const Route = createFileRoute("/supplier/products/$productId/edit")({
  component: SupplierProductEditPage,
});

function SupplierProductEditPage() {
  const { productId } = Route.useParams();
  return <SupplierProductForm productId={productId} />;
}
