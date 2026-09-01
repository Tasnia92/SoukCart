import type { FormEvent } from "react";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Field } from "./Field.tsx";
import type { AuthFeedback, AuthFormSubmitHandler, RegistrationDetails } from "./types.ts";

export const PASSWORD_MISMATCH_MESSAGE = "Passwords do not match.";

export type RegisterFormProps = {
  feedback?: AuthFeedback | null;
  onSubmit: AuthFormSubmitHandler<RegistrationDetails>;
  onSwitchToLogin?: () => void;
  onTerms?: () => void;
  pending?: boolean;
};

export function RegisterForm({
  feedback = null,
  onSubmit,
  onSwitchToLogin,
  onTerms,
  pending = false,
}: RegisterFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = form.elements.namedItem("password");
    const confirmation = form.elements.namedItem("confirm-password");

    if (password instanceof HTMLInputElement && confirmation instanceof HTMLInputElement) {
      confirmation.setCustomValidity(
        password.value === confirmation.value ? "" : PASSWORD_MISMATCH_MESSAGE,
      );
    }

    if (!form.reportValidity()) {
      return;
    }

    const formData = new FormData(form);
    const email = formData.get("email");
    const name = formData.get("name");
    const registrationPassword = formData.get("password");
    void onSubmit({
      email: typeof email === "string" ? email : "",
      name: typeof name === "string" ? name : "",
      password: typeof registrationPassword === "string" ? registrationPassword : "",
    });
  };

  const handleInput = (event: FormEvent<HTMLFormElement>) => {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) ||
      (target.name !== "password" && target.name !== "confirm-password")
    ) {
      return;
    }

    const confirmation = event.currentTarget.elements.namedItem("confirm-password");
    if (confirmation instanceof HTMLInputElement) {
      confirmation.setCustomValidity("");
    }
  };

  const feedbackClassName = feedback
    ? `form-feedback is-visible is-${feedback.state ?? "info"}`
    : "form-feedback";

  return (
    <form
      className="auth-form"
      data-auth-form="register"
      onInput={handleInput}
      onSubmit={handleSubmit}
    >
      <div className="field-stack">
        <Field
          autoComplete="name"
          id="register-name"
          icon="person"
          label="Full name"
          name="name"
          placeholder="Your full name"
          type="text"
        />
        <Field
          autoComplete="email"
          id="register-email"
          icon="mail"
          label="Email address"
          name="email"
          placeholder="Enter your email address"
          type="email"
        />
        <Field
          autoComplete="new-password"
          id="register-password"
          icon="lock"
          label="Password"
          name="password"
          placeholder="Create a password"
          type="password"
        />
        <Field
          autoComplete="new-password"
          id="register-confirm-password"
          icon="lock"
          label="Confirm password"
          name="confirm-password"
          placeholder="Repeat your password"
          type="password"
        />
      </div>

      <label className="checkbox-label terms-label">
        <input type="checkbox" name="terms" required />
        <span className="checkbox-control">
          <Icon name="check" />
        </span>
        <span>
          I agree to the{" "}
          <Button variant="text" type="button" data-terms="" disabled={pending} onClick={onTerms}>
            terms of service
          </Button>
          .
        </span>
      </label>

      <Button block type="submit" disabled={pending}>
        <span>Create account</span>
      </Button>

      <p className={feedbackClassName} data-form-feedback role="status" aria-live="polite">
        {feedback?.message}
      </p>
      <p className="auth-switch">
        Already have an account?{" "}
        <Button
          variant="text"
          type="button"
          data-switch-auth="login"
          disabled={pending}
          onClick={onSwitchToLogin}
        >
          Sign in
        </Button>
      </p>
    </form>
  );
}
