import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite-plus";

// Absolute path so the rolldown-based resolver treats "@" as <root>/src rather than a
// filesystem-absolute "/src" (which fails on Windows). Every shadcn/ui registry component
// imports via "@/...", so this alias must resolve for them to load at runtime.
const srcPath = new URL("./src", import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, "$1");

export default defineConfig({
  plugins: [
    // Must run before other plugins so the generated route tree is available to the bundler.
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      quoteStyle: "double",
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": srcPath },
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
