import { describe, expect, it } from "vite-plus/test";
import { resolveAuthAccess, type AuthArea, type AuthDecision } from "./auth-access.ts";
import { classifySession, type SessionState } from "./session.tsx";
import type { Session } from "@supabase/supabase-js";

function session(id: string): Session {
  return { user: { id } } as Session;
}

const signedInSession = session("matrix-user");
const states: Record<SessionState["status"], SessionState> = {
  loading: { status: "loading" },
  "signed-out": { status: "signed-out" },
  "missing-profile": classifySession(signedInSession, null),
  roleless: classifySession(signedInSession, {
    id: "matrix-user",
    email: "matrix@example.com",
    name: "Matrix User",
    role: null,
  }),
  admin: classifySession(signedInSession, {
    id: "matrix-user",
    email: "matrix@example.com",
    name: "Matrix User",
    role: "admin",
  }),
  retailer: classifySession(signedInSession, {
    id: "matrix-user",
    email: "matrix@example.com",
    name: "Matrix User",
    role: "retailer",
  }),
  seller: classifySession(signedInSession, {
    id: "matrix-user",
    email: "matrix@example.com",
    name: "Matrix User",
    role: "seller",
  }),
  "unknown-role": classifySession(signedInSession, {
    id: "matrix-user",
    email: "matrix@example.com",
    name: "Matrix User",
    role: "other",
  }),
};

const statusOrder: SessionState["status"][] = [
  "loading",
  "signed-out",
  "missing-profile",
  "roleless",
  "admin",
  "retailer",
  "seller",
  "unknown-role",
];

function decisionLabel(decision: AuthDecision): string {
  if (decision.kind === "redirect" || decision.kind === "sign-out-redirect") {
    return `${decision.kind}:${decision.to}`;
  }
  return decision.kind;
}

function decisionsFor(area: AuthArea): string[] {
  return statusOrder.map((status) => decisionLabel(resolveAuthAccess(area, states[status])));
}

describe("role access matrix", () => {
  it("keeps public payment routes independent of auth state", () => {
    expect(decisionsFor("public-payment")).toEqual(statusOrder.map(() => "render"));
  });

  it("dispatches root users by known role and renders all root auth states", () => {
    expect(decisionsFor("root")).toEqual([
      "render",
      "render",
      "render",
      "render",
      "redirect:/admin",
      "redirect:/retailer",
      "redirect:/supplier",
      "render",
    ]);
  });

  it("preserves signed-out admin login and denies every signed-in non-admin", () => {
    expect(decisionsFor("admin")).toEqual([
      "render",
      "render",
      "deny-admin",
      "deny-admin",
      "render",
      "deny-admin",
      "deny-admin",
      "deny-admin",
    ]);
  });

  it("admits only retailers to retailer workspaces", () => {
    expect(decisionsFor("retailer")).toEqual([
      "render",
      "redirect:/",
      "sign-out-redirect:/",
      "redirect:/",
      "redirect:/admin",
      "render",
      "redirect:/supplier",
      "redirect:/",
    ]);
  });

  it("admits only sellers to supplier workspaces", () => {
    expect(decisionsFor("supplier")).toEqual([
      "render",
      "redirect:/",
      "sign-out-redirect:/",
      "redirect:/",
      "redirect:/admin",
      "redirect:/retailer",
      "render",
      "redirect:/",
    ]);
  });
});
