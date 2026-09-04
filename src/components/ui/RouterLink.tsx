import { Link } from "@tanstack/react-router";
import type { AnchorHTMLAttributes } from "react";

export type RouterLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  hash?: string;
};

export function RouterLink({ to, params = {}, search, hash, ...props }: RouterLinkProps) {
  return <Link {...props} from="/" to={to} params={params} search={search} hash={hash} />;
}
