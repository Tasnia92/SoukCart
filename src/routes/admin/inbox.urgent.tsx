import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/inbox/urgent")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/inbox", replace: true });
  },
});
