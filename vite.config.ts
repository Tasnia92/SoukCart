import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

// Absolute path so the rolldown-based resolver treats "@" as <root>/src rather than a
// filesystem-absolute "/src" (which fails on Windows). Every shadcn/ui registry component
// imports via "@/...", so this alias must resolve for them to load at runtime. The same alias
// is applied to each Vitest project below because the inline test projects do not inherit the
// root `resolve.alias`, and the node "unit" module runner would otherwise fail to resolve "@/...".
const srcPath = new URL("./src", import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, "$1");
const resolveAlias = { "@": srcPath };

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
    alias: resolveAlias,
  },
  test: {
    projects: [
      {
        resolve: { alias: resolveAlias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.browser.test.{ts,tsx}"],
        },
      },
      {
        resolve: { alias: resolveAlias },
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.{ts,tsx}"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
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
