import { createFileRoute } from "@tanstack/react-router";
import { RetailerStorefront } from "../../features/retailer/RetailerStorefront.tsx";

export type RetailerHomeSearch = {
  /** Product search term carried over from the shared header search box. */
  q?: string;
};

export const Route = createFileRoute("/retailer/")({
  validateSearch: (search: Record<string, unknown>): RetailerHomeSearch => ({
    q: typeof search.q === "string" && search.q ? search.q : undefined,
  }),
  component: RetailerStorefront,
});
