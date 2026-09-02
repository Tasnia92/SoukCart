import type { Session } from "@supabase/supabase-js";
import { createContext, type ReactNode, useContext, useEffect, useSyncExternalStore } from "react";
import { supabase } from "./supabase.ts";

export type Profile = {
  id: string;
  email: string;
  name: string;
  role: string | null;
};

type SignedInState = { session: Session; profile: Profile };

export type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | ({ status: "missing-profile"; error?: string } & Pick<SignedInState, "session">)
  | ({ status: "roleless" } & SignedInState)
  | ({ status: "admin" } & SignedInState)
  | ({ status: "retailer" } & SignedInState)
  | ({ status: "seller" } & SignedInState)
  | ({ status: "unknown-role" } & SignedInState);

export type SessionSnapshot = {
  state: SessionState;
  adminError: string | null;
};

type GatewayResult = { error: string | null };
type ProfileResult = { profile: Profile | null; error: string | null };

export type SessionGateway = {
  getSession: () => Promise<{ session: Session | null; error: string | null }>;
  getProfile: (userId: string) => Promise<ProfileResult>;
  subscribe: (listener: (session: Session | null) => void) => () => void;
  signIn: (email: string, password: string) => Promise<GatewayResult>;
  signUp: (email: string, password: string, name: string) => Promise<GatewayResult>;
  signOut: () => Promise<GatewayResult>;
  updateRole: (userId: string, role: AccountRole) => Promise<GatewayResult>;
};

export type AccountRole = "retailer" | "seller";

export const supabaseSessionGateway: SessionGateway = {
  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    return { session: data.session, error: error?.message ?? null };
  },
  async getProfile(userId) {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, name, role")
      .eq("id", userId)
      .maybeSingle();
    return { profile: data as Profile | null, error: error?.message ?? null };
  },
  subscribe(listener) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => listener(session));
    return () => data.subscription.unsubscribe();
  },
  async signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  },
  async signUp(email, password, name) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    return { error: error?.message ?? null };
  },
  async signOut() {
    const { error } = await supabase.auth.signOut();
    return { error: error?.message ?? null };
  },
  async updateRole(userId, role) {
    const { error } = await supabase.from("users").update({ role }).eq("id", userId);
    return { error: error?.message ?? null };
  },
};

export function classifySession(
  session: Session | null,
  profile: Profile | null,
  profileError: string | null = null,
): SessionState {
  if (!session) {
    return { status: "signed-out" };
  }
  if (!profile) {
    return {
      status: "missing-profile",
      session,
      ...(profileError ? { error: profileError } : {}),
    };
  }
  switch (profile.role) {
    case null:
    case "":
      return { status: "roleless", session, profile };
    case "admin":
      return { status: "admin", session, profile };
    case "retailer":
      return { status: "retailer", session, profile };
    case "seller":
      return { status: "seller", session, profile };
    default:
      return { status: "unknown-role", session, profile };
  }
}

export class SessionStore {
  private snapshot: SessionSnapshot = { state: { status: "loading" }, adminError: null };
  private readonly listeners = new Set<() => void>();
  private refreshGeneration = 0;
  private refreshPromise: Promise<SessionState> | null = null;
  private latestRefreshPromise: Promise<SessionState> | null = null;
  private startCount = 0;
  private unsubscribeAuth: (() => void) | null = null;
  private adminDenialPromise: Promise<void> | null = null;
  private readonly gateway: SessionGateway;

  constructor(gateway: SessionGateway = supabaseSessionGateway) {
    this.gateway = gateway;
  }

  readonly getSnapshot = (): SessionSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): () => void {
    this.startCount += 1;
    if (this.startCount === 1) {
      let unsubscribeAuth: () => void;
      unsubscribeAuth = this.gateway.subscribe((session) => {
        queueMicrotask(() => {
          if (this.unsubscribeAuth === unsubscribeAuth) void this.refresh(session);
        });
      });
      this.unsubscribeAuth = unsubscribeAuth;
    }

    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.startCount = Math.max(0, this.startCount - 1);
      if (this.startCount === 0) {
        this.unsubscribeAuth?.();
        this.unsubscribeAuth = null;
      }
    };
  }

  async ensureReady(): Promise<SessionState> {
    return this.snapshot.state.status === "loading" ? this.refresh() : this.snapshot.state;
  }

  async refresh(sessionOverride?: Session | null): Promise<SessionState> {
    if (sessionOverride === undefined && this.refreshPromise) {
      return this.refreshPromise;
    }

    const generation = ++this.refreshGeneration;
    const work = this.loadState(sessionOverride);
    let tracked: Promise<SessionState>;
    tracked = work
      .then((state) => {
        if (generation === this.refreshGeneration) {
          this.setSnapshot({ ...this.snapshot, state });
          return state;
        }

        const latestRefresh = this.latestRefreshPromise;
        return latestRefresh && latestRefresh !== tracked ? latestRefresh : this.snapshot.state;
      })
      .finally(() => {
        if (this.latestRefreshPromise === tracked) this.latestRefreshPromise = null;
        if (this.refreshPromise === tracked) this.refreshPromise = null;
      });

    this.latestRefreshPromise = tracked;
    if (sessionOverride === undefined) this.refreshPromise = tracked;
    return tracked;
  }

  clearAdminError(): void {
    if (this.snapshot.adminError) {
      this.setSnapshot({ ...this.snapshot, adminError: null });
    }
  }

  async denyAdminAccess(): Promise<void> {
    if (this.adminDenialPromise) return this.adminDenialPromise;
    this.setSnapshot({ ...this.snapshot, adminError: "This account is not an admin." });
    this.adminDenialPromise = this.gateway
      .signOut()
      .then(() => this.refresh(null))
      .then(() => undefined)
      .finally(() => {
        this.adminDenialPromise = null;
      });
    return this.adminDenialPromise;
  }

  async signIn(email: string, password: string): Promise<GatewayResult> {
    this.clearAdminError();
    const result = await this.gateway.signIn(email, password);
    if (!result.error) await this.refresh();
    return result;
  }

  async register(
    email: string,
    password: string,
    name: string,
    role?: AccountRole,
  ): Promise<GatewayResult & { needsConfirmation?: boolean }> {
    const signUp = await this.gateway.signUp(email, password, name);
    if (signUp.error) return signUp;
    const signIn = await this.gateway.signIn(email, password);
    if (signIn.error) return { error: null, needsConfirmation: true };
    await this.refresh();
    if (role) await this.applyChosenRole(role);
    return { error: null };
  }

  /**
   * Assigns the role the visitor picked on the auth screen right after signup,
   * so retailer/supplier accounts skip the standalone role chooser. Only fires
   * when a fresh, roleless profile exists; otherwise the chooser stays as the
   * fallback (e.g. when email confirmation defers the session).
   */
  private async applyChosenRole(role: AccountRole): Promise<void> {
    const state = this.snapshot.state;
    if (state.status !== "roleless" || !("session" in state)) return;
    const result = await this.gateway.updateRole(state.session.user.id, role);
    if (!result.error) await this.refresh();
  }

  async chooseRole(role: AccountRole): Promise<GatewayResult> {
    const state = this.snapshot.state;
    if (!("session" in state)) return { error: "Your session has expired. Please sign in again." };
    const result = await this.gateway.updateRole(state.session.user.id, role);
    if (!result.error) await this.refresh();
    return result;
  }

  async signOut(): Promise<GatewayResult> {
    this.clearAdminError();
    const result = await this.gateway.signOut();
    await this.refresh(null);
    return result;
  }

  async signOutForGuard(): Promise<void> {
    await this.gateway.signOut();
    await this.refresh(null);
  }

  private async loadState(sessionOverride?: Session | null): Promise<SessionState> {
    let session = sessionOverride;
    if (sessionOverride === undefined) {
      const result = await this.gateway.getSession();
      if (result.error || !result.session) return { status: "signed-out" };
      session = result.session;
    }
    if (!session) return { status: "signed-out" };
    const { profile, error } = await this.gateway.getProfile(session.user.id);
    return classifySession(session, profile, error);
  }

  private setSnapshot(snapshot: SessionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

export const sessionStore = new SessionStore();

const SessionContext = createContext<SessionStore | null>(null);

export function SessionProvider({
  children,
  store = sessionStore,
}: {
  children: ReactNode;
  store?: SessionStore;
}) {
  useEffect(() => store.start(), [store]);
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

export function useSessionStore(): SessionStore {
  const store = useContext(SessionContext);
  if (!store) throw new Error("useSessionStore must be used within SessionProvider");
  return store;
}

export function useSessionSnapshot(): SessionSnapshot {
  const store = useSessionStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function sessionStateKey(snapshot: SessionSnapshot): string {
  const { state } = snapshot;
  const userId = "session" in state ? state.session.user.id : "";
  return `${state.status}:${userId}:${snapshot.adminError ?? ""}`;
}
