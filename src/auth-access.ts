import type { SessionState } from "./session.tsx";

export type AuthArea = "root" | "auth" | "admin" | "retailer" | "supplier" | "public-payment";
export type AuthDecision =
  | { kind: "render" }
  | { kind: "redirect"; to: "/" | "/admin" | "/retailer" | "/supplier" }
  | { kind: "deny-admin" }
  | { kind: "sign-out-redirect"; to: "/" };

export function resolveAuthAccess(area: AuthArea, state: SessionState): AuthDecision {
  if (area === "public-payment") return { kind: "render" };
  if (state.status === "loading") return { kind: "render" };

  if (area === "root") {
    switch (state.status) {
      case "admin":
        return { kind: "redirect", to: "/admin" };
      case "retailer":
        return { kind: "redirect", to: "/retailer" };
      case "seller":
        return { kind: "redirect", to: "/supplier" };
      default:
        return { kind: "render" };
    }
  }

  // Dedicated /login and /register pages for signed-out visitors.
  if (area === "auth") {
    switch (state.status) {
      case "signed-out":
        return { kind: "render" };
      case "admin":
        return { kind: "redirect", to: "/admin" };
      case "retailer":
        return { kind: "redirect", to: "/retailer" };
      case "seller":
        return { kind: "redirect", to: "/supplier" };
      default:
        return { kind: "redirect", to: "/" };
    }
  }

  if (area === "admin") {
    if (state.status === "signed-out" || state.status === "admin") return { kind: "render" };
    return { kind: "deny-admin" };
  }

  if (area === "retailer") {
    switch (state.status) {
      case "retailer":
        return { kind: "render" };
      case "admin":
        return { kind: "redirect", to: "/admin" };
      case "seller":
        return { kind: "redirect", to: "/supplier" };
      case "missing-profile":
        return { kind: "sign-out-redirect", to: "/" };
      default:
        return { kind: "redirect", to: "/" };
    }
  }

  switch (state.status) {
    case "seller":
      return { kind: "render" };
    case "admin":
      return { kind: "redirect", to: "/admin" };
    case "retailer":
      return { kind: "redirect", to: "/retailer" };
    case "missing-profile":
      return { kind: "sign-out-redirect", to: "/" };
    default:
      return { kind: "redirect", to: "/" };
  }
}
