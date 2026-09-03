import type { FormEvent } from "react";
import { LockKeyholeIcon, MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field as UIField, FieldGroup, FieldLabel } from "@/components/ui/field";
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

  const feedbackClassName =
    feedback?.state === "error"
      ? "min-h-5 text-sm font-medium text-destructive"
      : "min-h-5 text-sm text-muted-foreground";

  return (
    <form className="flex flex-col gap-5" data-auth-form="login" onSubmit={handleSubmit}>
      <FieldGroup>
        <Field
          autoComplete="email"
          id="login-email"
          icon={MailIcon}
          label="Email address"
          name="email"
          placeholder="Enter your email"
          type="email"
        />
        <Field
          autoComplete="current-password"
          id="login-password"
          icon={LockKeyholeIcon}
          label="Password"
          name="password"
          placeholder="Enter your password"
          type="password"
        />
      </FieldGroup>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <UIField orientation="horizontal">
          <Checkbox id="login-remember" name="remember" />
          <FieldLabel htmlFor="login-remember">Keep me signed in</FieldLabel>
        </UIField>
        {showForgotPassword ? (
          <Button
            type="button"
            variant="link"
            size="sm"
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
        <p className="text-center text-sm text-muted-foreground">
          New to SoukCart?{" "}
          <Button
            type="button"
            variant="link"
            size="sm"
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
