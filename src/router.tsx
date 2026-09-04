import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen.ts";
import { sessionStore } from "./session.tsx";

export const router = createRouter({
  routeTree,
  context: { session: sessionStore },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
