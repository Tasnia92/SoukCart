import { renderField } from "./Field.ts";
import { renderIcon } from "./Icon.ts";

export function renderRegisterForm(): string {
  return `<form class="auth-form" data-auth-form="register">
    <div class="field-stack">
      ${renderField({
        autocomplete: "name",
        id: "register-name",
        icon: "person",
        label: "Full name",
        name: "name",
        placeholder: "Your full name",
        type: "text",
      })}
      ${renderField({
        autocomplete: "email",
        id: "register-email",
        icon: "mail",
        label: "Email address",
        name: "email",
        placeholder: "Enter your email address",
        type: "email",
      })}
      ${renderField({
        autocomplete: "new-password",
        id: "register-password",
        icon: "lock",
        label: "Password",
        name: "password",
        placeholder: "Create a password",
        type: "password",
      })}
      ${renderField({
        autocomplete: "new-password",
        id: "register-confirm-password",
        icon: "lock",
        label: "Confirm password",
        name: "confirm-password",
        placeholder: "Repeat your password",
        type: "password",
      })}
    </div>

    <label class="checkbox-label terms-label">
      <input type="checkbox" name="terms" required />
      <span class="checkbox-control">${renderIcon("check")}</span>
      <span>I agree to the <button class="text-button" type="button" data-terms>terms of service</button>.</span>
    </label>

    <button class="button button-primary button-block" type="submit">
      <span>Create account</span>
    </button>

    <p class="form-feedback" data-form-feedback role="status" aria-live="polite"></p>
    <p class="auth-switch">Already have an account? <button class="text-button" type="button" data-switch-auth="login">Sign in</button></p>
  </form>`;
}
