import type { AuthRole } from "./types.ts";

export type AuthSearch = {
  role: AuthRole;
};

export function parseAuthSearch(search: Record<string, unknown>): AuthSearch {
  return {
    role: search.role === "seller" ? "seller" : "retailer",
  };
}
