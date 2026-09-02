import { useState } from "react";
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
  RegistrationDetails,
} from "./types.ts";

function useAuthCallbacks() {
  const store = useSessionStore();
  return {
    login: async (
      { email, password }: LoginCredentials,
      _role: AuthRole,
    ): Promise<AuthFeedback | undefined> => {
      const result = await store.signIn(email, password);
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

/**
 * Signed-out visitors land on the marketing page. Its two hero buttons open the
 * shared auth screen pre-set to the retailer or supplier path; the tab on the
 * auth screen lets them switch, and the brand link points back at "/".
 */
function PublicEntry({
  login,
  register,
}: {
  login: ReturnType<typeof useAuthCallbacks>["login"];
  register: ReturnType<typeof useAuthCallbacks>["register"];
}) {
  const [auth, setAuth] = useState<{ mode: AuthMode; role: AuthRole } | null>(null);

  if (!auth) {
    return <LandingPage onOpenAuth={(options) => setAuth(options)} />;
  }

  return (
    <AuthScreen
      initialMode={auth.mode}
      initialRole={auth.role}
      onLogin={login}
      onRegister={register}
    />
  );
}

export function RootAuthRoute() {
  const { state } = useSessionSnapshot();
  const callbacks = useAuthCallbacks();

  switch (state.status) {
    case "loading":
      return <SessionLoading />;
    case "signed-out":
      return <PublicEntry login={callbacks.login} register={callbacks.register} />;
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
