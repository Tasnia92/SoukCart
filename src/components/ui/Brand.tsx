import type { AnchorHTMLAttributes } from "react";

type BrandProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "aria-label" | "children"> & {
  variant?: "default" | "dark";
};

export function Brand({ variant = "default", className, ...props }: BrandProps) {
  const classes = ["brand", variant === "dark" && "brand-dark", className]
    .filter(Boolean)
    .join(" ");

  return (
    <a {...props} className={classes} href={props.href ?? "/"} aria-label="SoukCart home">
      <img className="brand-logo" src="/soukcart-logo.png" alt="" width="1536" height="1024" />
      <span className="brand-word">SoukCart</span>
    </a>
  );
}
