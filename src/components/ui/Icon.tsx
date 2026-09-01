import type { SVGProps } from "react";

export type IconName =
  | "activity"
  | "arrow-right"
  | "arrow-up-right"
  | "apple"
  | "bag"
  | "cart"
  | "check"
  | "clock"
  | "download"
  | "eye"
  | "eye-off"
  | "facebook"
  | "home"
  | "image"
  | "instagram"
  | "layers"
  | "linkedin"
  | "lock"
  | "mail"
  | "message"
  | "minus"
  | "package"
  | "person"
  | "plus"
  | "refresh"
  | "search"
  | "shield-check"
  | "store"
  | "trash"
  | "truck"
  | "users";

export const iconPaths: Record<IconName, string> = {
  activity:
    '<path d="M3.5 12h4l2.5-6.5 4.5 13 2.5-6.5h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  "arrow-up-right":
    '<path d="M5 19 19 5M9 5h10v10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  apple:
    '<path d="M15.7 12.6c0-2 1.7-3 1.8-3.1-1-.1-2.1 1-2.7 1-.6.1-1.5-1-2.5-1-1.3 0-2.5.8-3.1 2-.7 1.2-.2 4 1.1 5.9.6.9 1.3 1.9 2.3 1.9.9 0 1.3-.6 2.5-.6s1.5.6 2.5.6c1 0 1.6-.9 2.2-1.8.7-1 1-2 1-2.1-.1 0-3.1-1.2-3.1-3.8Zm-1.7-8.2c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.5 1 .1 1.9-.4 2.5-1.1Z" fill="currentColor"/>',
  check:
    '<path d="m5 12 4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  eye: '<path d="M2.8 12s3.3-5 9.2-5 9.2 5 9.2 5-3.3 5-9.2 5-9.2-5-9.2-5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.3" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  "eye-off":
    '<path d="m3.5 3.5 17 17M10.3 6.9c.5-.1 1.1-.1 1.7-.1 5.9 0 9.2 5.2 9.2 5.2a16.6 16.6 0 0 1-3.1 3.3M6.2 8.2C4 9.3 2.8 12 2.8 12s3.3 5.2 9.2 5.2c1.2 0 2.3-.2 3.2-.6M14.3 14.3a3.3 3.3 0 0 1-4.6-4.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  layers:
    '<path d="m12 3.8 8.2 4.3-8.2 4.3-8.2-4.3L12 3.8Z M3.8 12l8.2 4.3 8.2-4.3 M3.8 16.2l8.2 4.3 8.2-4.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  lock: '<rect x="5.2" y="10" width="13.6" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.2 10V7.8a3.8 3.8 0 0 1 7.6 0V10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="14.8" r="1.1" fill="currentColor"/>',
  mail: '<rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m4.5 7 7.5 5.4L19.5 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  message:
    '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v8a1.5 1.5 0 0 1-1.5 1.5H9.5L5 19v-4.5H5.5A1.5 1.5 0 0 1 4 13v-7.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  person:
    '<circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5.3 20c.6-3.1 3.1-5 6.7-5s6.1 1.9 6.7 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  refresh:
    '<path d="M19.2 8.8A7.5 7.5 0 0 0 5.4 6.7L3.5 8.6M3.5 8.6V4.8M3.5 8.6h3.8M4.8 15.2a7.5 7.5 0 0 0 13.8 2.1l1.9-1.9M20.5 15.4v3.8M20.5 15.4h-3.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  search:
    '<circle cx="10.8" cy="10.8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m16 16 4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  store:
    '<path d="M4 10.2V20h16v-9.8M3 10.2h18L19 4H5l-2 6.2Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.2 14h3.6v6H8.2zM4 10.2a2.5 2.5 0 0 0 4.5 1.5 2.5 2.5 0 0 0 4.5 0 2.5 2.5 0 0 0 4.5 0 2.5 2.5 0 0 0 2.5-1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  bag: '<path d="M5.5 8h13l-1 12h-11l-1-12Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.8 10V6.4a3.2 3.2 0 0 1 6.4 0V10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  cart: '<path d="M4 5h2.2l2.1 9.2a1.5 1.5 0 0 0 1.5 1.2h6.7a1.5 1.5 0 0 0 1.5-1.2L20 8H6.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.8" cy="19.5" r="1.2" fill="currentColor"/><circle cx="16.6" cy="19.5" r="1.2" fill="currentColor"/>',
  clock:
    '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  download:
    '<path d="M12 4.5v10.5m0 0 4-4m-4 4-4-4M5 19.5h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  home: '<path d="m4.5 10.5 7.5-6.5 7.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19v-8.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.5 20.5v-6h5v6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  image:
    '<rect x="3.2" y="4.8" width="17.6" height="14.4" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="10.2" r="1.6" fill="currentColor"/><path d="m5.5 17.5 4.5-4.5 3 3 2.5-2.5 3 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  minus:
    '<path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  package:
    '<path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M4 8l8 4.5L20 8M12 12.5V20.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  trash:
    '<path d="M5.5 7.5h13M9.5 7.5V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M7 7.5l.8 11a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4l.8-11M10.2 11v5M13.8 11v5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  truck:
    '<path d="M3 6.5h11v10H3zM14 10h4l3 3v3.5h-7M6.5 18.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6ZM17.5 18.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',

  /* Landing surface: audience, assurance, forward motion and social marks. */
  "arrow-right":
    '<path d="M4.5 12h14M13 6.5 18.5 12 13 17.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  users:
    '<circle cx="9.4" cy="8.4" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.2 19.6c.6-3 2.9-4.9 6.2-4.9s5.6 1.9 6.2 4.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M16 5.6a3.2 3.2 0 0 1 0 5.6M18.1 14.8c1.6.8 2.6 2.1 3 3.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  "shield-check":
    '<path d="M12 3.3 19 5.7v5.2c0 4-2.8 7.5-7 9.6-4.2-2.1-7-5.6-7-9.6V5.7l7-2.4Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m8.9 11.9 2.4 2.4 4-4.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  facebook:
    '<path d="M13.6 20.6v-7.2h2.5l.4-2.9h-2.9V8.6c0-.8.3-1.4 1.5-1.4h1.5V4.6c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.1H8v2.9h2.5v7.2h3.1Z" fill="currentColor"/>',
  instagram:
    '<rect x="4.2" y="4.2" width="15.6" height="15.6" rx="4.6" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="16.5" cy="7.5" r="1.1" fill="currentColor"/>',
  linkedin:
    '<path d="M4.7 9.6h2.8v10.3H4.7zM6.1 4.4a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z" fill="currentColor"/><path d="M10 9.6h2.7V11a3.1 3.1 0 0 1 2.8-1.6c2.4 0 3.8 1.5 3.8 4.3v6.2h-2.8v-5.7c0-1.4-.5-2.3-1.8-2.3s-1.9.8-1.9 2.3v5.7H10V9.6Z" fill="currentColor"/>',
};

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
