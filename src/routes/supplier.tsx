import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SupplierGate } from "../features/supplier/SupplierGate.tsx";
import { guardAuthArea } from "../lib/route-guards.ts";

export const Route = createFileRoute("/supplier")({
  beforeLoad: async ({ context }) => {
    await guardAuthArea(context.session, "supplier");
  },
  component: SupplierLayout,
});

function SupplierLayout() {
  return (
    <SupplierGate>
      <Outlet />
    </SupplierGate>
  );
}
