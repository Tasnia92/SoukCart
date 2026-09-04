import { createFileRoute } from "@tanstack/react-router";
import { RetailerStorefront } from "../../features/retailer/RetailerStorefront.tsx";

function RetailerCatalogRoute() {
  return <RetailerStorefront variant="catalog" />;
}

// The full product listing. The storefront at /retailer stays the cockpit home.
export const Route = createFileRoute("/retailer/catalog")({
  component: RetailerCatalogRoute,
});
