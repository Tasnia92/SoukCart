import type { AnchorHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BrandProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "aria-label" | "children"> & {
  variant?: "default" | "dark";
};

export function Brand({ variant = "default", className, ...props }: BrandProps) {
  return (
    <a
      {...props}
      className={cn(
        "inline-flex items-center gap-2.5 self-start font-heading text-xl font-semibold no-underline",
        variant === "dark" ? "text-primary-foreground" : "text-foreground",
        className,
      )}
      href={props.href ?? "/"}
      aria-label="SoukCart home"
    >
      <img
        className="size-9 object-contain"
        src="/soukcart-logo.png"
        alt=""
        width="36"
        height="36"
      />
      <span className="tracking-tight">soukcart</span>
    </a>
  );
}
