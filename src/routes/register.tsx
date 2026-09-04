import { createFileRoute } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { PublicAuthRoute } from "../components/auth/AuthRoutes.tsx";
import { parseAuthSearch } from "../components/auth/auth-search.ts";
import { guardAuthArea } from "../lib/route-guards.ts";

export const Route = createFileRoute("/register")({
  validateSearch: parseAuthSearch,
  beforeLoad: async ({ context }) => {
    await guardAuthArea(context.session, "auth");
  },
  component: RegisterRoute,
});

function RegisterRoute(): ReactElement {
  const { role } = Route.useSearch();
  return <PublicAuthRoute mode="register" role={role} />;
}
