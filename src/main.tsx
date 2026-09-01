import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-sans/800.css";
import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-500.css";
import "./tailwind.css";
import "./theme.css";
import "./style.css";
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

const root = createRoot(app);
const showGallery =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("__gallery");

if (showGallery) {
  void import("./dev/ComponentGallery.tsx").then(({ ComponentGallery }) => {
    root.render(
      <StrictMode>
        <ComponentGallery />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <SessionProvider store={sessionStore}>
        <RoutedApp store={sessionStore} />
      </SessionProvider>
    </StrictMode>,
  );
}
