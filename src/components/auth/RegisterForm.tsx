import type { FormEvent } from "react";
import { LockKeyholeIcon, MailIcon, UserRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field as UIField, FieldGroup, FieldLabel } from "@/components/ui/field";
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

  const feedbackClassName =
    feedback?.state === "error"
      ? "min-h-5 text-sm font-medium text-destructive"
      : "min-h-5 text-sm text-muted-foreground";

  return (
    <form
      className="flex flex-col gap-5"
      data-auth-form="register"
      onInput={handleInput}
      onSubmit={handleSubmit}
    >
      <FieldGroup>
        <Field
          autoComplete="name"
          id="register-name"
          icon={UserRoundIcon}
          label="Full name"
          name="name"
          placeholder="Your full name"
          type="text"
        />
        <Field
          autoComplete="email"
          id="register-email"
          icon={MailIcon}
          label="Email address"
          name="email"
          placeholder="Enter your email address"
          type="email"
        />
        <Field
          autoComplete="new-password"
          id="register-password"
          icon={LockKeyholeIcon}
          label="Password"
          name="password"
          placeholder="Create a password"
          type="password"
        />
        <Field
          autoComplete="new-password"
          id="register-confirm-password"
          icon={LockKeyholeIcon}
          label="Confirm password"
          name="confirm-password"
          placeholder="Repeat your password"
          type="password"
        />
      </FieldGroup>

      <UIField orientation="horizontal">
        <Checkbox id="register-terms" name="terms" required />
        <FieldLabel htmlFor="register-terms">
          I agree to the{" "}
          <Button
            type="button"
            variant="link"
            size="sm"
            data-terms=""
            disabled={pending}
            onClick={onTerms}
          >
            terms of service
          </Button>
          .
        </FieldLabel>
      </UIField>

      <Button className="w-full" type="submit" disabled={pending}>
        <span>Create account</span>
      </Button>

      <p className={feedbackClassName} data-form-feedback role="status" aria-live="polite">
        {feedback?.message}
      </p>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Button
          type="button"
          variant="link"
          size="sm"
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
