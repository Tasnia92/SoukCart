import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/activity")({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `/admin/order${location.searchStr}${location.hash}`,
      replace: true,
    });
  },
});
