import type { SVGProps } from "react";
import { iconPaths, type IconName } from "../Icon.ts";

export { type IconName };
export const ICON_NAMES = Object.keys(iconPaths) as IconName[];

type IconProps = Omit<
  SVGProps<SVGSVGElement>,
  "aria-hidden" | "children" | "dangerouslySetInnerHTML" | "focusable" | "viewBox"
> & {
  name: IconName;
};

export function Icon({ name, className = "icon", ...props }: IconProps) {
  return (
    <svg
      {...props}
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: iconPaths[name] }}
    />
  );
}
