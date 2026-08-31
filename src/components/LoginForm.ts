import { renderField } from "./Field.ts";
import { renderIcon } from "./Icon.ts";

export type LoginFormOptions = {
  showForgotPassword?: boolean;
  showCreateAccount?: boolean;
};

export function renderLoginForm(options: LoginFormOptions = {}): string {
  const { showForgotPassword = true, showCreateAccount = true } = options;

  return `<form class="auth-form" data-auth-form="login">
    <div class="field-stack">
      ${renderField({
        autocomplete: "email",
        id: "login-email",
        icon: "mail",
        label: "Email address",
        name: "email",
        placeholder: "Enter your email",
        type: "email",
      })}
      ${renderField({
        autocomplete: "current-password",
        id: "login-password",
        icon: "lock",
        label: "Password",
        name: "password",
        placeholder: "Enter your password",
        type: "password",
      })}
    </div>

    <div class="form-options">
      <label class="checkbox-label">
        <input type="checkbox" name="remember" />
        <span class="checkbox-control">${renderIcon("check")}</span>
        <span>Keep me signed in</span>
      </label>
      ${showForgotPassword ? '<button class="text-button" type="button" data-forgot-password>Forgot password?</button>' : ""}
    </div>

    <button class="button button-primary button-block" type="submit">
      <span>Sign in</span>
    </button>

    <p class="form-feedback" data-form-feedback role="status" aria-live="polite"></p>
    ${showCreateAccount ? '<p class="auth-switch">New to SoukCart? <button class="text-button" type="button" data-switch-auth="register">Create an account</button></p>' : ""}
  </form>`;
}
