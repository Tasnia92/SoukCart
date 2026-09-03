import type { FormEvent } from "react";
import { Button } from "../ui/button.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import { Field as UIField, FieldGroup, FieldLabel } from "../ui/field.tsx";
import { Field } from "./Field.tsx";
import type { AuthFeedback, AuthFormSubmitHandler, LoginCredentials } from "./types.ts";

export type LoginFormProps = {
  feedback?: AuthFeedback | null;
  onForgotPassword?: () => void;
  onSwitchToRegister?: () => void;
  onSubmit: AuthFormSubmitHandler<LoginCredentials>;
  pending?: boolean;
  showCreateAccount?: boolean;
  showForgotPassword?: boolean;
};

export function LoginForm({
  feedback = null,
  onForgotPassword,
  onSwitchToRegister,
  onSubmit,
  pending = false,
  showCreateAccount = true,
  showForgotPassword = true,
}: LoginFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;

    if (!form.reportValidity()) {
      return;
    }

    const formData = new FormData(form);
    const email = formData.get("email");
    const password = formData.get("password");
    void onSubmit({
      email: typeof email === "string" ? email : "",
      password: typeof password === "string" ? password : "",
      remember: formData.has("remember"),
    });
  };

  const feedbackClassName = feedback
    ? `form-feedback is-visible is-${feedback.state ?? "info"}`
    : "form-feedback";

  return (
    <form className="auth-form" data-auth-form="login" onSubmit={handleSubmit}>
      <FieldGroup className="field-stack">
        <Field
          autoComplete="email"
          id="login-email"
          icon="mail"
          label="Email address"
          name="email"
          placeholder="Enter your email"
          type="email"
        />
        <Field
          autoComplete="current-password"
          id="login-password"
          icon="lock"
          label="Password"
          name="password"
          placeholder="Enter your password"
          type="password"
        />
      </FieldGroup>

      <div className="form-options">
        <UIField orientation="horizontal">
          <Checkbox id="login-remember" name="remember" />
          <FieldLabel htmlFor="login-remember">Keep me signed in</FieldLabel>
        </UIField>
        {showForgotPassword ? (
          <Button
            variant="link"
            data-forgot-password=""
            disabled={pending}
            onClick={onForgotPassword}
          >
            Forgot password?
          </Button>
        ) : null}
      </div>

      <Button className="w-full" type="submit" disabled={pending}>
        <span>Sign in</span>
      </Button>

      <p className={feedbackClassName} data-form-feedback role="status" aria-live="polite">
        {feedback?.message}
      </p>
      {showCreateAccount ? (
        <p className="auth-switch">
          New to SoukCart?{" "}
          <Button
            variant="link"
            data-switch-auth="register"
            disabled={pending}
            onClick={onSwitchToRegister}
          >
            Create an account
          </Button>
        </p>
      ) : null}
    </form>
  );
}
