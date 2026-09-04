import { redirect } from "@tanstack/react-router";
import { resolveAuthAccess, type AuthArea } from "../auth-access.ts";
import { PAYMENT_RETURN_KEY } from "../features/retailer/payment-return-api.ts";
import type { SessionStore } from "../session.tsx";

export const publicPaymentResultPaths = [
  "/retailer/checkout/success",
  "/retailer/checkout/failed",
  "/retailer/checkout/cancelled",
] as const;

export const publicPaymentPathSet = new Set<string>(publicPaymentResultPaths);

function getPaymentReturn(): string | null {
  return sessionStorage.getItem(PAYMENT_RETURN_KEY);
}

export function isRootPaymentLocation(location: { pathname: string; searchStr: string }): boolean {
  return (
    location.pathname === "/" &&
    (Boolean(new URLSearchParams(location.searchStr).get("status")) || Boolean(getPaymentReturn()))
  );
}

export async function guardAuthArea(store: SessionStore, area: AuthArea): Promise<void> {
  const state = await store.ensureReady();
  const decision = resolveAuthAccess(area, state);

  switch (decision.kind) {
    case "render":
      return;
    case "redirect":
      throw redirect({ href: decision.to, replace: true });
    case "deny-admin":
      await store.denyAdminAccess();
      return;
    case "sign-out-redirect":
      await store.signOutForGuard();
      throw redirect({ href: decision.to, replace: true });
  }
}
