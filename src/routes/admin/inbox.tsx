import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AdminInbox } from "../../features/admin/AdminInbox.tsx";

export const Route = createFileRoute("/admin/inbox")({
  component: InboxLayout,
});

function InboxLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Legacy /urgent and /queue redirect in their own beforeLoad; keep an outlet for them.
  if (pathname === "/admin/inbox") {
    return <AdminInbox />;
  }
  return <Outlet />;
}
