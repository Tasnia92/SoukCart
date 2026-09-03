import type { Ref } from "react";
import { Brand } from "@/components/ui/Brand";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <div
      className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.85fr)]"
      data-auth-mode={resolvedMode}
      data-auth-role={role}
    >
      <main className="flex min-w-0 items-center justify-center px-4 py-8 sm:px-6 lg:px-10">
        <div className="flex w-full max-w-xl flex-col gap-6">
          <Brand />
          <section aria-labelledby="auth-title">
            <Card>
              <CardHeader className="gap-5">
                {!isAdmin ? (
                  <RoleTabs value={role} onChange={onRoleChange} disabled={pending} />
                ) : null}
                <div className="flex flex-col gap-2">
                  {!isAdmin ? <p className="text-sm font-medium text-primary">{eyebrow}</p> : null}
                  <CardTitle>
                    <h1
                      id="auth-title"
                      className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
                      tabIndex={-1}
                      ref={headingRef}
                    >
                      {title}
                    </h1>
                  </CardTitle>
                  {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
                </div>
              </CardHeader>
              <CardContent>
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
              </CardContent>
              {isLogin && !isAdmin ? (
                <CardFooter className="flex-col justify-center gap-1 border-t text-center text-sm text-muted-foreground sm:flex-row">
                  <span>By continuing, you agree to SoukCart&apos;s</span>
                  <Button
                    variant="link"
                    size="sm"
                    type="button"
                    data-terms=""
                    disabled={pending}
                    onClick={onTerms}
                  >
                    Terms &amp; Privacy.
                  </Button>
                </CardFooter>
              ) : null}
            </Card>
          </section>
        </div>
      </main>
      <AuthStory />
    </div>
  );

  return shell;
}
