import { createFileRoute } from "@tanstack/react-router";
import { RetailerCart } from "../../features/retailer/RetailerCart.tsx";

export const Route = createFileRoute("/retailer/cart")({
  component: RetailerCart,
});
