import { createFileRoute } from "@tanstack/react-router";
import { RetailerCatalog } from "../../features/retailer/RetailerCatalog.tsx";

export const Route = createFileRoute("/retailer/catalog")({
  component: RetailerCatalog,
});
