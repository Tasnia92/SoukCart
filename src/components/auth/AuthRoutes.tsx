import { useState } from "react";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { AuthScreen } from "./AuthScreen.tsx";
import { RoleChooser, type AccountRole } from "./RoleChooser.tsx";
import { SessionLoading } from "./SessionLoading.tsx";
import { SignedInFallback } from "./SignedInFallback.tsx";
import type { AuthFeedback, LoginCredentials, RegistrationDetails } from "./types.ts";

function useAuthCallbacks() {
  const store = useSessionStore();
  return {
    login: async ({ email, password }: LoginCredentials): Promise<AuthFeedback | undefined> => {
      const result = await store.signIn(email, password);
      return result.error ? { message: result.error, state: "error" } : undefined;
    },
    register: async ({
      email,
      password,
      name,
    }: RegistrationDetails): Promise<AuthFeedback | undefined> => {
      const result = await store.register(email, password, name);
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

export function RootAuthRoute() {
  const { state } = useSessionSnapshot();
  const callbacks = useAuthCallbacks();

  switch (state.status) {
    case "loading":
      return <SessionLoading />;
    case "signed-out":
      return <AuthScreen onLogin={callbacks.login} onRegister={callbacks.register} />;
    case "missing-profile":
    case "roleless":
      return <RoleSetup />;
    case "unknown-role":
      return <UnknownRoleScreen />;
    default:
      return <SessionLoading />;
  }
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
