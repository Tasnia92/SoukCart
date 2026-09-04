import { createFileRoute } from "@tanstack/react-router";
import { RetailerComplaints } from "../../features/retailer/RetailerComplaints.tsx";

export const Route = createFileRoute("/retailer/complaints")({
  component: RetailerComplaints,
});
