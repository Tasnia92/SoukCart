import { createFileRoute } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { PublicAuthRoute } from "../components/auth/AuthRoutes.tsx";
import { parseAuthSearch } from "../components/auth/auth-search.ts";
import { guardAuthArea } from "../lib/route-guards.ts";

export const Route = createFileRoute("/login")({
  validateSearch: parseAuthSearch,
  beforeLoad: async ({ context }) => {
    await guardAuthArea(context.session, "auth");
  },
  component: LoginRoute,
});

function LoginRoute(): ReactElement {
  const { role } = Route.useSearch();
  return <PublicAuthRoute mode="login" role={role} />;
}
