import type { Session } from "@supabase/supabase-js";
import { describe, expect, it } from "vite-plus/test";
import {
  classifySession,
  SessionStore,
  type AccountRole,
  type Profile,
  type SessionGateway,
} from "./session.tsx";

function makeSession(id: string): Session {
  return {
    access_token: `access-${id}`,
    expires_in: 3600,
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
    user: {
      app_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00.000Z",
      id,
      user_metadata: {},
    },
  } as Session;
}

function makeProfile(id: string, role: string | null): Profile {
  return { id, email: `${id}@example.com`, name: id, role };
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

class FakeGateway implements SessionGateway {
  session: Session | null = null;
  profiles = new Map<string, Profile>();
  signInError: string | null = null;
  signUpError: string | null = null;
  signOutError: string | null = null;
  updateRoleError: string | null = null;
  sessionAfterSignIn: Session | null | undefined;
  sessionOnSubscribe: Session | null | undefined;
  getSessionCalls = 0;
  getProfileCalls = 0;
  subscribeCalls = 0;
  unsubscribeCalls = 0;
  signOutCalls = 0;
  signInArguments: Array<[string, string]> = [];
  signUpArguments: Array<[string, string, string]> = [];
  updateRoleArguments: Array<[string, AccountRole]> = [];
  private readonly authListeners = new Set<(session: Session | null) => void>();

  getSessionHandler: SessionGateway["getSession"] = async () => ({
    session: this.session,
    error: null,
  });

  getProfileHandler: SessionGateway["getProfile"] = async (userId) => ({
    profile: this.profiles.get(userId) ?? null,
    error: null,
  });

  getSession = () => {
    this.getSessionCalls += 1;
    return this.getSessionHandler();
  };

  getProfile = (userId: string) => {
    this.getProfileCalls += 1;
    return this.getProfileHandler(userId);
  };

  subscribe = (listener: (session: Session | null) => void) => {
    this.subscribeCalls += 1;
    this.authListeners.add(listener);
    if (this.sessionOnSubscribe !== undefined) listener(this.sessionOnSubscribe);
    return () => {
      if (this.authListeners.delete(listener)) this.unsubscribeCalls += 1;
    };
  };

  signIn = async (email: string, password: string) => {
    this.signInArguments.push([email, password]);
    if (!this.signInError && this.sessionAfterSignIn !== undefined) {
      this.session = this.sessionAfterSignIn;
    }
    return { error: this.signInError };
  };

  signUp = async (email: string, password: string, name: string) => {
    this.signUpArguments.push([email, password, name]);
    return { error: this.signUpError };
  };

  signOut = async () => {
    this.signOutCalls += 1;
    if (!this.signOutError) this.session = null;
    return { error: this.signOutError };
  };

  updateRole = async (userId: string, role: AccountRole) => {
    this.updateRoleArguments.push([userId, role]);
    const profile = this.profiles.get(userId);
    if (!this.updateRoleError && profile) this.profiles.set(userId, { ...profile, role });
    return { error: this.updateRoleError };
  };

  emit(session: Session | null): void {
    for (const listener of this.authListeners) listener(session);
  }
}

describe("session classification", () => {
  const session = makeSession("user-1");

  it("starts in the explicit loading state", () => {
    expect(new SessionStore(new FakeGateway()).getSnapshot().state.status).toBe("loading");
  });

  it.each([
    ["signed-out", null, null, null],
    ["missing-profile", session, null, "Profile unavailable"],
    ["roleless", session, makeProfile("user-1", null), null],
    ["admin", session, makeProfile("user-1", "admin"), null],
    ["retailer", session, makeProfile("user-1", "retailer"), null],
    ["seller", session, makeProfile("user-1", "seller"), null],
    ["unknown-role", session, makeProfile("user-1", "unexpected"), null],
  ] as const)("classifies %s", (expected, currentSession, profile, error) => {
    expect(classifySession(currentSession, profile, error).status).toBe(expected);
  });
});

describe("SessionStore lifecycle", () => {
  it("uses the initial auth subscription event as the only startup load", async () => {
    const gateway = new FakeGateway();
    const session = makeSession("initial-admin");
    gateway.sessionOnSubscribe = session;
    gateway.profiles.set("initial-admin", makeProfile("initial-admin", "admin"));
    const store = new SessionStore(gateway);
    let unsubscribeSnapshot: () => void = () => undefined;
    const initialized = new Promise<void>((resolve) => {
      unsubscribeSnapshot = store.subscribe(() => {
        if (store.getSnapshot().state.status === "admin") resolve();
      });
    });

    const stop = store.start();
    await initialized;

    expect(gateway.getSessionCalls).toBe(0);
    expect(gateway.getProfileCalls).toBe(1);
    unsubscribeSnapshot();
    stop();
  });

  it("deduplicates subscriptions and cleans each subscription up exactly once", async () => {
    const gateway = new FakeGateway();
    const store = new SessionStore(gateway);
    const stopFirst = store.start();
    const stopSecond = store.start();

    expect(gateway.subscribeCalls).toBe(1);
    stopFirst();
    expect(gateway.unsubscribeCalls).toBe(0);
    stopSecond();
    stopSecond();
    expect(gateway.unsubscribeCalls).toBe(1);

    const stopThird = store.start();
    expect(gateway.subscribeCalls).toBe(2);
    stopThird();
    expect(gateway.unsubscribeCalls).toBe(2);
    await store.ensureReady();
  });

  it("waits for the newest auth generation and suppresses stale initial state", async () => {
    const gateway = new FakeGateway();
    const initialSession = deferred<{ session: Session | null; error: string | null }>();
    const latestProfile = deferred<{ profile: Profile | null; error: string | null }>();
    const adminSession = makeSession("old-admin");
    const sellerSession = makeSession("new-seller");
    gateway.getSessionHandler = () => initialSession.promise;
    gateway.getProfileHandler = (userId) =>
      userId === "new-seller"
        ? latestProfile.promise
        : Promise.resolve({ profile: makeProfile(userId, "admin"), error: null });

    const store = new SessionStore(gateway);
    const stop = store.start();
    const ready = store.ensureReady();
    gateway.emit(sellerSession);
    await Promise.resolve();
    initialSession.resolve({ session: adminSession, error: null });
    await Promise.resolve();
    latestProfile.resolve({ profile: makeProfile("new-seller", "seller"), error: null });

    expect((await ready).status).toBe("seller");
    expect(store.getSnapshot().state.status).toBe("seller");
    expect(gateway.getSessionCalls).toBe(1);
    stop();
  });

  it("preserves the admin denial error and signs out concurrent denials once", async () => {
    const gateway = new FakeGateway();
    gateway.session = makeSession("retailer-1");
    gateway.profiles.set("retailer-1", makeProfile("retailer-1", "retailer"));
    const store = new SessionStore(gateway);
    await store.refresh();

    await Promise.all([store.denyAdminAccess(), store.denyAdminAccess()]);

    expect(gateway.signOutCalls).toBe(1);
    expect(store.getSnapshot()).toEqual({
      state: { status: "signed-out" },
      adminError: "This account is not an admin.",
    });
  });
});

describe("SessionStore auth operations", () => {
  it("refreshes login state, updates a role, and signs out", async () => {
    const gateway = new FakeGateway();
    const session = makeSession("account-1");
    gateway.sessionAfterSignIn = session;
    gateway.profiles.set("account-1", makeProfile("account-1", null));
    const store = new SessionStore(gateway);

    expect(await store.signIn("account@example.com", "secret123")).toEqual({ error: null });
    expect(gateway.signInArguments).toEqual([["account@example.com", "secret123"]]);
    expect(store.getSnapshot().state.status).toBe("roleless");

    expect(await store.chooseRole("seller")).toEqual({ error: null });
    expect(gateway.updateRoleArguments).toEqual([["account-1", "seller"]]);
    expect(store.getSnapshot().state.status).toBe("seller");

    expect(await store.signOut()).toEqual({ error: null });
    expect(store.getSnapshot()).toEqual({ state: { status: "signed-out" }, adminError: null });
  });

  it("preserves signup metadata and reports the confirmation fallback", async () => {
    const gateway = new FakeGateway();
    gateway.signInError = "Email not confirmed";
    const store = new SessionStore(gateway);

    expect(await store.register("new@example.com", "secret123", "New User")).toEqual({
      error: null,
      needsConfirmation: true,
    });
    expect(gateway.signUpArguments).toEqual([["new@example.com", "secret123", "New User"]]);
    expect(gateway.signInArguments).toEqual([["new@example.com", "secret123"]]);
  });

  it("returns an expired-session error when role selection has no session", async () => {
    const store = new SessionStore(new FakeGateway());
    expect(await store.chooseRole("retailer")).toEqual({
      error: "Your session has expired. Please sign in again.",
    });
  });
});
