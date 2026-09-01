import "./tailwind.css";
import "./theme.css";
import "./style.css";
import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { router } from "./router.tsx";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("The application root could not be found.");
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
  root.render(<RouterProvider router={router} />);
}
