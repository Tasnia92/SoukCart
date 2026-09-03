import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "subtle" | "text" | "destructive";
export type ButtonSize = "default" | "compact" | "icon";

type ButtonStyleOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "button button-primary",
  secondary: "button button-secondary",
  subtle: "button button-subtle",
  text: "text-button",
  destructive: "delete-button",
};

export function buttonClassName({
  variant = "primary",
  size = "default",
  block = false,
  className,
}: ButtonStyleOptions = {}): string {
  return [
    variantClasses[variant],
    size === "compact" && "button-compact",
    size === "icon" && "icon-button",
    block && "button-block",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyleOptions;

export function Button({
  variant = "primary",
  size = "default",
  block = false,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={buttonClassName({ variant, size, block, className })}
    />
  );
}
