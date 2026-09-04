import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/retailer/$")({
  beforeLoad: () => {
    throw redirect({ to: "/retailer", replace: true });
  },
});
