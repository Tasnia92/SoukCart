import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { AuthShell } from "./components/auth/AuthShell.tsx";
import { FORGOT_PASSWORD_FEEDBACK, TERMS_FEEDBACK } from "./components/auth/AuthScreen.tsx";
import { AuthStory } from "./components/auth/AuthStory.tsx";
import { LoginForm } from "./components/auth/LoginForm.tsx";
import { PASSWORD_MISMATCH_MESSAGE, RegisterForm } from "./components/auth/RegisterForm.tsx";
import { RoleChooser } from "./components/auth/RoleChooser.tsx";
import { SignedInFallback } from "./components/auth/SignedInFallback.tsx";

const doNothing = () => undefined;

describe("React auth presentation contract", () => {
  it("preserves login names, IDs, password state, and live feedback", () => {
    const markup = renderToStaticMarkup(<LoginForm onSubmit={doNothing} />);

    expect(markup).toContain('data-auth-form="login"');
    expect(markup).toContain('for="login-email"');
    expect(markup).toContain('id="login-email"');
    expect(markup).toContain('name="email"');
    expect(markup).toContain('type="email"');
    expect(markup).toContain('for="login-password"');
    expect(markup).toContain('id="login-password"');
    expect(markup).toContain('name="password"');
    expect(markup).toContain('name="remember"');
    expect(markup).toContain('aria-controls="login-password"');
    expect(markup).toContain('aria-label="Show password"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Keep me signed in");
    expect(markup).toContain("Forgot password?");
  });

  it("preserves registration fields, required terms, and mismatch copy", () => {
    const markup = renderToStaticMarkup(<RegisterForm onSubmit={doNothing} />);

    expect(markup).toContain('data-auth-form="register"');
    for (const [id, name] of [
      ["register-name", "name"],
      ["register-email", "email"],
      ["register-password", "password"],
      ["register-confirm-password", "confirm-password"],
    ]) {
      expect(markup).toContain(`for="${id}"`);
      expect(markup).toContain(`id="${id}"`);
      expect(markup).toContain(`name="${name}"`);
    }
    expect(markup).toContain('name="terms"');
    expect(markup).toContain('type="checkbox" required=""');
    expect(markup).toContain('aria-controls="register-password"');
    expect(markup).toContain('aria-controls="register-confirm-password"');
    expect(PASSWORD_MISMATCH_MESSAGE).toBe("Passwords do not match.");
  });

  it("keeps mode headings focusable and the admin login embedded and login-only", () => {
    const publicMarkup = renderToStaticMarkup(
      <AuthShell mode="register" onLogin={doNothing} onRegister={doNothing} />,
    );
    const adminMarkup = renderToStaticMarkup(
      <AuthShell mode="register" onLogin={doNothing} onRegister={doNothing} variant="admin" />,
    );

    expect(publicMarkup).toContain('data-auth-mode="register"');
    expect(publicMarkup).toContain('id="auth-title"');
    expect(publicMarkup).toContain('tabindex="-1"');
    expect(publicMarkup).toContain("Create an account.");
    expect(adminMarkup).toContain('class="admin-login"');
    expect(adminMarkup).toContain('data-auth-mode="login"');
    expect(adminMarkup).toContain("Admin sign in");
    expect(adminMarkup).not.toContain("Create an account");
    expect(adminMarkup).not.toContain("Forgot password?");
  });

  it("preserves placeholder feedback and role/fallback controls", () => {
    expect(FORGOT_PASSWORD_FEEDBACK).toEqual({
      message: "Password recovery will be available when authentication is connected.",
      state: "info",
    });
    expect(TERMS_FEEDBACK).toEqual({
      message: "Terms and privacy details will be available soon.",
      state: "info",
    });

    const chooser = renderToStaticMarkup(<RoleChooser onSelectRole={doNothing} />);
    expect(chooser).toContain('data-role="seller"');
    expect(chooser).toContain('data-role="retailer"');
    expect(chooser).toContain("I&#x27;m a seller");
    expect(chooser).toContain("I&#x27;m a retailer");

    const fallback = renderToStaticMarkup(<SignedInFallback onLogout={doNothing} />);
    expect(fallback).toContain('data-logout=""');
    expect(fallback).toContain("You&#x27;re signed in.");
  });

  it("keeps the auth illustration and highlights intact", () => {
    const markup = renderToStaticMarkup(<AuthStory />);
    expect(markup).toContain('aria-label="SoukCart highlights"');
    expect(markup).toContain('viewBox="0 0 400 300"');
    expect(markup).toContain("Sell everywhere. Stay in sync.");
    expect(markup).toContain("Storefront sync");
    expect(markup).toContain("Live inventory");
    expect(markup).toContain("Order routing");
  });
});
