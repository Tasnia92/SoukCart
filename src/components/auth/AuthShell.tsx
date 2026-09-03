import type { Ref } from "react";
import { Brand } from "../ui/Brand.tsx";
import { Button } from "@/components/ui/button";
import { AuthStory } from "./AuthStory.tsx";
import { LoginForm } from "./LoginForm.tsx";
import { RegisterForm } from "./RegisterForm.tsx";
import { RoleTabs } from "./RoleTabs.tsx";
import type {
  AuthFeedback,
  AuthFormSubmitHandler,
  AuthMode,
  AuthRole,
  AuthShellVariant,
  LoginCredentials,
  RegistrationDetails,
} from "./types.ts";

export type AuthShellProps = {
  feedback?: AuthFeedback | null;
  headingRef?: Ref<HTMLHeadingElement>;
  mode: AuthMode;
  onForgotPassword?: () => void;
  onLogin: AuthFormSubmitHandler<LoginCredentials>;
  onRegister: AuthFormSubmitHandler<RegistrationDetails>;
  onRoleChange?: (role: AuthRole) => void;
  onSwitchMode?: (mode: AuthMode) => void;
  onTerms?: () => void;
  pending?: boolean;
  role?: AuthRole;
  variant?: AuthShellVariant;
};

export function AuthShell({
  feedback = null,
  headingRef,
  mode,
  onForgotPassword,
  onLogin,
  onRegister,
  onRoleChange,
  onSwitchMode,
  onTerms,
  pending = false,
  role = "retailer",
  variant = "public",
}: AuthShellProps) {
  const isAdmin = variant === "admin";
  const resolvedMode: AuthMode = isAdmin ? "login" : mode;
  const isLogin = resolvedMode === "login";
  const roleLabel = role === "seller" ? "supplier" : "retailer";
  const eyebrow = isLogin ? "Welcome" : "Get started";
  const title = isAdmin
    ? "Admin sign in"
    : isLogin
      ? "Your business, in sync."
      : "Create an account.";
  const subtitle = isAdmin
    ? "Sign in to manage every storefront from one clear, connected view."
    : isLogin
      ? `Sign in to your ${roleLabel} workspace and manage every order from one clear view.`
      : `Set up your ${roleLabel} account to start ${
          role === "seller" ? "selling on" : "buying from"
        } SoukCart.`;

  const shell = (
    <div className="auth-layout" data-auth-mode={resolvedMode} data-auth-role={role}>
      <main className="auth-main">
        <div className="auth-content">
          <Brand />
          <section className="auth-section" aria-labelledby="auth-title">
            {!isAdmin ? <RoleTabs value={role} onChange={onRoleChange} disabled={pending} /> : null}
            <div className="auth-intro">
              {!isAdmin ? <p className="eyebrow">{eyebrow}</p> : null}
              <h1 id="auth-title" className="display-xl" tabIndex={-1} ref={headingRef}>
                {title}
              </h1>
              {subtitle ? <p className="body-copy">{subtitle}</p> : null}
            </div>
            {isLogin ? (
              <LoginForm
                feedback={feedback}
                onForgotPassword={onForgotPassword}
                onSubmit={onLogin}
                onSwitchToRegister={() => onSwitchMode?.("register")}
                pending={pending}
                showCreateAccount={!isAdmin}
                showForgotPassword={!isAdmin}
              />
            ) : (
              <RegisterForm
                feedback={feedback}
                onSubmit={onRegister}
                onSwitchToLogin={() => onSwitchMode?.("login")}
                onTerms={onTerms}
                pending={pending}
              />
            )}
          </section>
          {isLogin && !isAdmin ? (
            <p className="auth-legal">
              By continuing, you agree to SoukCart&apos;s{" "}
              <Button
                variant="link"
                className="h-auto p-0"
                type="button"
                data-terms=""
                disabled={pending}
                onClick={onTerms}
              >
                Terms &amp; Privacy.
              </Button>
            </p>
          ) : null}
        </div>
      </main>
      <AuthStory />
    </div>
  );

  return isAdmin ? <div className="admin-login">{shell}</div> : shell;
}
