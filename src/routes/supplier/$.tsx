import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/supplier/$")({
  beforeLoad: () => {
    throw redirect({ to: "/supplier", replace: true });
  },
});
