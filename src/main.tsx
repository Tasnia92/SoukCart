import "./tailwind.css";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router.tsx";
import {
  SessionProvider,
  sessionStateKey,
  sessionStore,
  type SessionStore,
  useSessionSnapshot,
} from "./session.tsx";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("The application root could not be found.");
}

function RoutedApp({ store }: { store: SessionStore }) {
  const snapshot = useSessionSnapshot();
  const stateKey = sessionStateKey(snapshot);

  useEffect(() => {
    void router.invalidate();
  }, [stateKey]);

  return <RouterProvider router={router} context={{ session: store }} />;
}

createRoot(app).render(
  <StrictMode>
    <SessionProvider store={sessionStore}>
      <RoutedApp store={sessionStore} />
    </SessionProvider>
  </StrictMode>,
);
