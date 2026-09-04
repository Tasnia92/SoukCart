import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { SupplierProducts } from "../../features/supplier/SupplierProducts.tsx";

export const Route = createFileRoute("/supplier/products")({
  component: ProductsLayout,
});

function ProductsLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname === "/supplier/products") {
    return <SupplierProducts />;
  }
  return <Outlet />;
}
