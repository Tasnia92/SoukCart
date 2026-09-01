import { useEffect, useRef, useState } from "react";
import { AuthShell } from "./AuthShell.tsx";
import type {
  AuthCallback,
  AuthFeedback,
  AuthMode,
  AuthShellVariant,
  LoginCredentials,
  RegistrationDetails,
} from "./types.ts";

export const FORGOT_PASSWORD_FEEDBACK: AuthFeedback = {
  message: "Password recovery will be available when authentication is connected.",
  state: "info",
};

export const TERMS_FEEDBACK: AuthFeedback = {
  message: "Terms and privacy details will be available soon.",
  state: "info",
};

export type AuthScreenProps = {
  initialFeedback?: AuthFeedback | null;
  initialMode?: AuthMode;
  onLogin: AuthCallback<LoginCredentials>;
  onRegister: AuthCallback<RegistrationDetails>;
  variant?: AuthShellVariant;
};

export function AuthScreen({
  initialFeedback = null,
  initialMode = "login",
  onLogin,
  onRegister,
  variant = "public",
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>(() => (variant === "admin" ? "login" : initialMode));
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<AuthFeedback | null>(initialFeedback);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeadingAfterSwitch = useRef(false);

  useEffect(() => {
    if (!focusHeadingAfterSwitch.current) {
      return;
    }

    focusHeadingAfterSwitch.current = false;
    headingRef.current?.focus();
  }, [mode]);

  const runAuthCallback = async <T,>(callback: AuthCallback<T>, values: T) => {
    if (pending) {
      return;
    }

    setPending(true);
    setFeedback(null);

    try {
      const nextFeedback = await callback(values);
      setFeedback(nextFeedback ?? null);
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Something went wrong. Please try again.",
        state: "error",
      });
    } finally {
      setPending(false);
    }
  };

  const switchMode = (nextMode: AuthMode) => {
    if (nextMode === mode || variant === "admin") {
      return;
    }

    focusHeadingAfterSwitch.current = true;
    setFeedback(null);
    setMode(nextMode);
  };

  return (
    <AuthShell
      feedback={feedback}
      headingRef={headingRef}
      mode={mode}
      onForgotPassword={() => setFeedback(FORGOT_PASSWORD_FEEDBACK)}
      onLogin={(values) => runAuthCallback(onLogin, values)}
      onRegister={(values) => runAuthCallback(onRegister, values)}
      onSwitchMode={switchMode}
      onTerms={() => setFeedback(TERMS_FEEDBACK)}
      pending={pending}
      variant={variant}
    />
  );
}
