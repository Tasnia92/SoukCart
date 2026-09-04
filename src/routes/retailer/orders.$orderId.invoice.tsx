import { createFileRoute } from "@tanstack/react-router";
import { RetailerInvoice } from "../../features/retailer/RetailerInvoice.tsx";

export const Route = createFileRoute("/retailer/orders/$orderId/invoice")({
  component: RetailerInvoicePage,
});

function RetailerInvoicePage() {
  const { orderId } = Route.useParams();
  return <RetailerInvoice orderId={orderId} />;
}
