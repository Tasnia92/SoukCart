import "./tailwind.css";
import "./theme.css";
import "./style.css";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";
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

// StrictMode stays off while legacy renderers own untracked listeners and async work.
const root = createRoot(app);
const showGallery =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("__gallery");

if (showGallery) {
  void import("./dev/ComponentGallery.tsx").then(({ ComponentGallery }) => {
    root.render(<ComponentGallery />);
  });
} else {
  root.render(
    <SessionProvider store={sessionStore}>
      <RoutedApp store={sessionStore} />
    </SessionProvider>,
  );
}
