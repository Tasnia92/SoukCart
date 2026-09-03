import "./tailwind.css";
import "./theme.css";
import "./style.css";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import { AuthScreen } from "./components/auth/AuthScreen.tsx";
import { LoginForm } from "./components/auth/LoginForm.tsx";
import { RegisterForm } from "./components/auth/RegisterForm.tsx";
import type { LoginCredentials, RegistrationDetails } from "./components/auth/types.ts";

const inBrowser = typeof document !== "undefined";
if (inBrowser) {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
}

async function mount(node: ReactNode): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

async function unmount(root: Root): Promise<void> {
  await act(async () => root.unmount());
  document.body.replaceChildren();
}

async function click(
  userEvent: { click: (target: Element) => Promise<void> },
  target: Element,
): Promise<void> {
  await act(async () => userEvent.click(target));
}

function element<T extends Element>(host: ParentNode, selector: string): T {
  const match = host.querySelector<T>(selector);
  if (!match) throw new Error(`Expected an element matching ${selector}`);
  return match;
}

describe("auth browser behavior", () => {
  it.runIf(inBrowser)(
    "switches modes, moves focus, and updates live placeholder feedback",
    async () => {
      const { userEvent } = await import("vite-plus/test/browser/context");
      const mounted = await mount(
        <AuthScreen onLogin={() => undefined} onRegister={() => undefined} />,
      );

      try {
        await click(userEvent, element(mounted.host, '[data-switch-auth="register"]'));
        const heading = element<HTMLHeadingElement>(mounted.host, "#auth-title");
        expect(heading.textContent).toBe("Create an account.");
        expect(document.activeElement).toBe(heading);

        await click(userEvent, element(mounted.host, '[data-terms=""]'));
        expect(element(mounted.host, "[data-form-feedback]").textContent).toBe(
          "Terms and privacy details will be available soon.",
        );

        await click(userEvent, element(mounted.host, '[data-switch-auth="login"]'));
        await click(userEvent, element(mounted.host, '[data-forgot-password=""]'));
        expect(element(mounted.host, "[data-form-feedback]").textContent).toBe(
          "Password recovery will be available when authentication is connected.",
        );

        const password = element<HTMLInputElement>(mounted.host, "#login-password");
        const toggle = element<HTMLButtonElement>(mounted.host, '[aria-controls="login-password"]');
        expect(password.type).toBe("password");
        expect(toggle.getAttribute("aria-pressed")).toBe("false");
        await click(userEvent, toggle);
        expect(password.type).toBe("text");
        expect(toggle.getAttribute("aria-label")).toBe("Hide password");
        expect(toggle.getAttribute("aria-pressed")).toBe("true");
      } finally {
        await unmount(mounted.root);
      }
    },
  );

  it.runIf(inBrowser)(
    "uses native login validity before submitting exact form values",
    async () => {
      const { userEvent } = await import("vite-plus/test/browser/context");
      const submissions: LoginCredentials[] = [];
      const mounted = await mount(
        <LoginForm
          onSubmit={(values) => {
            submissions.push(values);
          }}
        />,
      );

      try {
        const submit = element<HTMLButtonElement>(mounted.host, 'button[type="submit"]');
        await click(userEvent, submit);
        expect(submissions).toHaveLength(0);

        await userEvent.fill(element(mounted.host, "#login-email"), "not-an-email");
        await userEvent.fill(element(mounted.host, "#login-password"), "secret123");
        await click(userEvent, submit);
        expect(submissions).toHaveLength(0);

        await userEvent.fill(element(mounted.host, "#login-email"), "user@example.com");
        await click(userEvent, element(mounted.host, "#login-remember"));
        await click(userEvent, submit);
        expect(submissions).toEqual([
          { email: "user@example.com", password: "secret123", remember: true },
        ]);
      } finally {
        await unmount(mounted.root);
      }
    },
  );

  it.runIf(inBrowser)(
    "blocks mismatched registration passwords with the native custom error",
    async () => {
      const { userEvent } = await import("vite-plus/test/browser/context");
      const submissions: RegistrationDetails[] = [];
      const mounted = await mount(
        <RegisterForm
          onSubmit={(values) => {
            submissions.push(values);
          }}
        />,
      );

      try {
        await userEvent.fill(element(mounted.host, "#register-name"), "Test User");
        await userEvent.fill(element(mounted.host, "#register-email"), "test@example.com");
        await userEvent.fill(element(mounted.host, "#register-password"), "secret123");
        await userEvent.fill(element(mounted.host, "#register-confirm-password"), "different");
        await click(userEvent, element(mounted.host, "#register-terms"));
        await click(userEvent, element(mounted.host, 'button[type="submit"]'));

        const confirmation = element<HTMLInputElement>(mounted.host, "#register-confirm-password");
        expect(submissions).toHaveLength(0);
        expect(confirmation.validationMessage).toBe("Passwords do not match.");

        await userEvent.fill(confirmation, "secret123");
        await click(userEvent, element(mounted.host, 'button[type="submit"]'));
        expect(submissions).toEqual([
          { email: "test@example.com", name: "Test User", password: "secret123" },
        ]);
      } finally {
        await unmount(mounted.root);
      }
    },
  );

  it.runIf(inBrowser)("keeps the auth layout responsive at all parity widths", async () => {
    const { page } = await import("vite-plus/test/browser/context");
    const mounted = await mount(
      <AuthScreen onLogin={() => undefined} onRegister={() => undefined} />,
    );

    try {
      for (const width of [1440, 992, 720, 560]) {
        await page.viewport(width, 900);
        const layout = element<HTMLElement>(mounted.host, ".auth-layout");
        const options = element<HTMLElement>(mounted.host, ".form-options");
        const heading = element<HTMLElement>(mounted.host, "#auth-title");
        const columns = getComputedStyle(layout).gridTemplateColumns.split(" ");

        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        expect(getComputedStyle(layout).display).toBe("grid");
        expect(columns.length).toBe(width > 992 ? 2 : 1);
        expect(getComputedStyle(options).flexDirection).toBe(width <= 560 ? "column" : "row");
        if (width === 560) expect(getComputedStyle(heading).fontSize).toBe("32px");
      }
    } finally {
      await page.viewport(1024, 768);
      await unmount(mounted.root);
    }
  });
});
