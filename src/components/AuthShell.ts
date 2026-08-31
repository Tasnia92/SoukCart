import { renderAuthStory } from "./AuthStory.ts";
import { renderBrand } from "./Brand.ts";
import { renderLoginForm } from "./LoginForm.ts";
import { renderRegisterForm } from "./RegisterForm.ts";

export type AuthMode = "login" | "register";

export type AuthShellOptions = {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  showEyebrow?: boolean;
  showLegal?: boolean;
  showCreateAccount?: boolean;
  showForgotPassword?: boolean;
};

export function renderAuthShell(mode: AuthMode, options: AuthShellOptions = {}): string {
  const isLogin = mode === "login";
  const {
    showEyebrow = true,
    showLegal = true,
    showCreateAccount = true,
    showForgotPassword = true,
  } = options;
  const eyebrow = options.eyebrow ?? (isLogin ? "Welcome" : "Get started");
  const title = options.title ?? (isLogin ? "Your business, in sync." : "Create an account.");
  const subtitle =
    options.subtitle ??
    (isLogin ? "Sign in to manage every storefront from one clear, connected view." : "");

  return `<div class="auth-layout" data-auth-mode="${mode}">
    <main class="auth-main">
      <div class="auth-content">
        ${renderBrand()}
        <section class="auth-section" aria-labelledby="auth-title">
          <div class="auth-intro">
            ${showEyebrow && eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}
            <h1 id="auth-title" class="display-xl" tabindex="-1">${title}</h1>
            ${subtitle ? `<p class="body-copy">${subtitle}</p>` : ""}
          </div>
          ${isLogin ? renderLoginForm({ showForgotPassword, showCreateAccount }) : renderRegisterForm()}
        </section>
        ${isLogin && showLegal ? '<p class="auth-legal">By continuing, you agree to SoukCart\'s <button class="text-button" type="button" data-terms>Terms &amp; Privacy.</button></p>' : ""}
      </div>
    </main>
    ${renderAuthStory()}
  </div>`;
}
