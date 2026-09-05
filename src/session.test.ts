import { afterEach, expect, test } from "vite-plus/test";
import type { Session } from "@supabase/supabase-js";
import { SessionStore, type Profile, type SessionGateway } from "./session.tsx";

function sessionFor(id: string): Session {
  return { user: { id } } as Session;
}

function createGateway(users: Record<string, { password: string; profile: Profile | null }>): {
  gateway: SessionGateway;
  signedInId: () => string | null;
  stop: () => void;
} {
  let current: Session | null = null;
  const listeners = new Set<(session: Session | null) => void>();

  const gateway: SessionGateway = {
    async getSession() {
      return { session: current, error: null };
    },
    async getProfile(userId) {
      return { profile: users[userId]?.profile ?? null, error: null };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email, password) {
      const entry = users[email];
      if (!entry || entry.password !== password) return { error: "Invalid login credentials" };
      current = sessionFor(email);
      for (const listener of listeners) listener(current);
      return { error: null };
    },
    async signUp() {
      return { error: null };
    },
    async signOut() {
      current = null;
      for (const listener of listeners) listener(null);
      return { error: null };
    },
    async updateRole() {
      return { error: null };
    },
  };

  return {
    gateway,
    signedInId: () => current?.user.id ?? null,
    stop: () => listeners.clear(),
  };
}

const users = {
  "retailer@test.com": {
    password: "secret",
    profile: { id: "retailer@test.com", email: "retailer@test.com", name: "R", role: "retailer" },
  },
  "seller@test.com": {
    password: "secret",
    profile: { id: "seller@test.com", email: "seller@test.com", name: "S", role: "seller" },
  },
  "admin@test.com": {
    password: "secret",
    profile: { id: "admin@test.com", email: "admin@test.com", name: "A", role: "admin" },
  },
} satisfies Record<string, { password: string; profile: Profile }>;

let stopGateway: (() => void) | undefined;
let stopStore: (() => void) | undefined;

afterEach(() => {
  stopStore?.();
  stopGateway?.();
  stopStore = undefined;
  stopGateway = undefined;
});

async function signInAs(email: keyof typeof users, expected: "retailer" | "seller" | "admin") {
  const { gateway, signedInId, stop } = createGateway(users);
  stopGateway = stop;
  const store = new SessionStore(gateway);
  stopStore = store.start();
  await store.ensureReady();
  const result = await store.signIn(email, "secret", expected);
  return { result, status: store.getSnapshot().state.status, signedInId: signedInId() };
}

test("retailer can sign in on the retailer screen", async () => {
  const { result, status, signedInId } = await signInAs("retailer@test.com", "retailer");
  expect(result.error).toBeNull();
  expect(status).toBe("retailer");
  expect(signedInId).toBe("retailer@test.com");
});

test("supplier cannot sign in on the retailer screen", async () => {
  const { result, status, signedInId } = await signInAs("seller@test.com", "retailer");
  expect(result.error).toBe("This account is a supplier. Switch to Supplier to sign in.");
  expect(status).toBe("signed-out");
  expect(signedInId).toBeNull();
});

test("admin cannot sign in on the retailer screen", async () => {
  const { result, status, signedInId } = await signInAs("admin@test.com", "retailer");
  expect(result.error).toBe("This is an admin account. Sign in at /admin.");
  expect(status).toBe("signed-out");
  expect(signedInId).toBeNull();
});

test("supplier can sign in on the supplier screen", async () => {
  const { result, status, signedInId } = await signInAs("seller@test.com", "seller");
  expect(result.error).toBeNull();
  expect(status).toBe("seller");
  expect(signedInId).toBe("seller@test.com");
});

test("retailer cannot sign in on the supplier screen", async () => {
  const { result, status, signedInId } = await signInAs("retailer@test.com", "seller");
  expect(result.error).toBe("This account is a retailer. Switch to Retailer to sign in.");
  expect(status).toBe("signed-out");
  expect(signedInId).toBeNull();
});

test("admin can sign in on /admin", async () => {
  const { result, status, signedInId } = await signInAs("admin@test.com", "admin");
  expect(result.error).toBeNull();
  expect(status).toBe("admin");
  expect(signedInId).toBe("admin@test.com");
});

test("retailer cannot sign in on /admin", async () => {
  const { result, status, signedInId } = await signInAs("retailer@test.com", "admin");
  expect(result.error).toBe("This account is not an admin.");
  expect(status).toBe("signed-out");
  expect(signedInId).toBeNull();
});
