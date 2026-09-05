import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LandingPage } from "../../features/landing/LandingPage.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { AuthScreen } from "./AuthScreen.tsx";
import { RoleChooser, type AccountRole } from "./RoleChooser.tsx";
import { SessionLoading } from "./SessionLoading.tsx";
import { SignedInFallback } from "./SignedInFallback.tsx";
import type {
  AuthFeedback,
  AuthMode,
  AuthRole,
  LoginCredentials,
  LoginRole,
  RegistrationDetails,
} from "./types.ts";

function useAuthCallbacks() {
  const store = useSessionStore();
  return {
    login: async (
      { email, password }: LoginCredentials,
      role: LoginRole,
    ): Promise<AuthFeedback | undefined> => {
      const result = await store.signIn(email, password, role);
      return result.error ? { message: result.error, state: "error" } : undefined;
    },
    register: async (
      { email, password, name }: RegistrationDetails,
      role: AuthRole,
    ): Promise<AuthFeedback | undefined> => {
      const result = await store.register(email, password, name, role);
      if (result.error) return { message: result.error, state: "error" };
      if (result.needsConfirmation) {
        return {
          message:
            "Account created. Please check your email to confirm your account, then sign in.",
          state: "success",
        };
      }
      return undefined;
    },
  };
}

function RoleSetup() {
  const store = useSessionStore();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<AuthFeedback | null>(null);

  const chooseRole = async (role: AccountRole) => {
    if (pending) return;
    setPending(true);
    setFeedback(null);
    const result = await store.chooseRole(role);
    if (result.error) setFeedback({ message: result.error, state: "error" });
    setPending(false);
  };

  return <RoleChooser feedback={feedback} onSelectRole={chooseRole} pending={pending} />;
}

function UnknownRoleScreen() {
  const store = useSessionStore();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<AuthFeedback | null>(null);

  const logout = async () => {
    if (pending) return;
    setPending(true);
    const result = await store.signOut();
    if (result.error) setFeedback({ message: result.error, state: "error" });
    setPending(false);
  };

  return <SignedInFallback feedback={feedback} onLogout={logout} pending={pending} />;
}

/** Marketing homepage for signed-out visitors. Auth lives on `/login` and `/register`. */
export function RootAuthRoute() {
  const { state } = useSessionSnapshot();

  switch (state.status) {
    case "loading":
      return <SessionLoading />;
    case "signed-out":
      return <LandingPage />;
    case "missing-profile":
    case "roleless":
      return <RoleSetup />;
    case "unknown-role":
      return <UnknownRoleScreen />;
    default:
      return <SessionLoading />;
  }
}

/** Dedicated public auth pages (`/login`, `/register`). */
export function PublicAuthRoute({ mode, role }: { mode: AuthMode; role: AuthRole }) {
  const { state } = useSessionSnapshot();
  const callbacks = useAuthCallbacks();
  const navigate = useNavigate();

  if (state.status === "loading") return <SessionLoading />;
  if (state.status !== "signed-out") return <SessionLoading />;

  return (
    <AuthScreen
      key={`${mode}-${role}`}
      initialMode={mode}
      initialRole={role}
      onLogin={callbacks.login}
      onRegister={callbacks.register}
      onModeChange={(nextMode) => {
        void navigate({
          to: nextMode === "login" ? "/login" : "/register",
          search: { role },
        });
      }}
      onRoleChange={(nextRole) => {
        void navigate({
          to: mode === "login" ? "/login" : "/register",
          search: { role: nextRole },
          replace: true,
        });
      }}
    />
  );
}

export function AdminAuthRoute() {
  const { state, adminError } = useSessionSnapshot();
  const callbacks = useAuthCallbacks();
  if (state.status !== "signed-out") return <SessionLoading />;
  return (
    <AuthScreen
      key={adminError ?? "admin-auth"}
      initialFeedback={adminError ? { message: adminError, state: "error" } : null}
      onLogin={callbacks.login}
      onRegister={callbacks.register}
      variant="admin"
    />
  );
}
