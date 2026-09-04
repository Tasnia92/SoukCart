import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { SessionStore } from "../session.tsx";

export type RouterContext = {
  session: SessionStore;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
});
