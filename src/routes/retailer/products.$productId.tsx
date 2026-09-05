import { createFileRoute } from "@tanstack/react-router";
import { RetailerProductPage } from "../../features/retailer/RetailerProductPage.tsx";

export const Route = createFileRoute("/retailer/products/$productId")({
  component: RetailerProductRoute,
});

function RetailerProductRoute() {
  const { productId } = Route.useParams();
  return <RetailerProductPage productId={productId} />;
}
