import type { AnchorHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const LOGO_SIZES = {
  default: { className: "size-9", width: 36, height: 36 },
  lg: { className: "size-11", width: 44, height: 44 },
} as const;

type BrandProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "aria-label" | "children"> & {
  variant?: "default" | "dark";
  size?: keyof typeof LOGO_SIZES;
};

export function Brand({ variant = "default", size = "default", className, ...props }: BrandProps) {
  const logo = LOGO_SIZES[size];

  return (
    <a
      {...props}
      className={cn(
        "inline-flex items-center gap-2.5 font-heading font-semibold no-underline",
        size === "lg" ? "text-2xl" : "text-xl",
        variant === "dark" ? "text-primary-foreground" : "text-foreground",
        className,
      )}
      href={props.href ?? "/"}
      aria-label="SoukCart home"
    >
      <img
        className={cn(logo.className, "shrink-0 object-contain")}
        src="/soukcart-logo.png"
        alt=""
        width={logo.width}
        height={logo.height}
      />
      <span className="tracking-tight">soukcart</span>
    </a>
  );
}
