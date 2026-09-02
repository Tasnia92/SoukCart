import { Link } from "@tanstack/react-router";
import type { AnchorHTMLAttributes } from "react";

export type RouterLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
  params?: Record<string, string>;
};

// The code-generated route array currently merges sibling dynamic params in Link's type map.
// Keep the workaround here while retaining TanStack client navigation at every React workspace link.
export function RouterLink({ to, params = {}, ...props }: RouterLinkProps) {
  return <Link {...props} from={"/" as never} to={to as never} params={params as never} />;
}
