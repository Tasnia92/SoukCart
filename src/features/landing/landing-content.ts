/* -----------------------------------------------------------------------------
 * Landing page copy and link inventory.
 *
 * PLACEHOLDER DESTINATIONS: SoukCart has no marketing routes yet, so every
 * navigation and footer destination below points at an in-page section (or a
 * canonical profile URL pattern). Nothing is a dead `#` and nothing 404s — but
 * these hrefs are meant to be replaced once the real marketing pages exist.
 * The section ids are declared in LandingPage.tsx.
 * -------------------------------------------------------------------------- */

import type { IconName } from "../../components/ui/Icon.tsx";

export const SECTION_IDS = {
  platform: "platform",
  howItWorks: "how-it-works",
  join: "join",
} as const;

export const NAV_LINKS = [
  { label: "For Retailers", href: `#${SECTION_IDS.join}` },
  { label: "For Suppliers", href: `#${SECTION_IDS.join}` },
  { label: "How it Works", href: `#${SECTION_IDS.howItWorks}` },
  { label: "About", href: `#${SECTION_IDS.platform}` },
] as const;

/* Overlay cards on the hero illustration — the four handoffs of one order. */
export const HANDOFF_STEPS = [
  { step: "01", title: "Supplier Stock", detail: "Ready to fulfill" },
  { step: "02", title: "Picked & Packed", detail: "Order confirmed" },
  { step: "03", title: "In Transit", detail: "On the way" },
  { step: "04", title: "Delivered", detail: "Stocked & ready" },
] as const;

export const PLATFORM_HIGHLIGHTS: {
  icon: IconName;
  title: string;
  copy: string;
}[] = [
  {
    icon: "package",
    title: "Clear product details",
    copy: "Keep product information, quantities, and order expectations easy to understand.",
  },
  {
    icon: "cart",
    title: "Straightforward ordering",
    copy: "Give retailers a simpler way to move from choosing products to placing an order.",
  },
  {
    icon: "truck",
    title: "One connected workflow",
    copy: "Keep suppliers and retailers aligned from confirmation through delivery.",
  },
];

export const FLOW_STEPS: {
  icon: IconName;
  step: string;
  title: string;
  copy: string;
}[] = [
  {
    icon: "search",
    step: "01",
    title: "Discover Products",
    copy: "Browse from a wide range of wholesale essentials.",
  },
  {
    icon: "cart",
    step: "02",
    title: "Place Order",
    copy: "Order against real-time stock with best pricing.",
  },
  {
    icon: "truck",
    step: "03",
    title: "Track Every Step",
    copy: "Follow your order from supplier to your shop.",
  },
  {
    icon: "store",
    step: "04",
    title: "Receive & Restock",
    copy: "Get delivered on time and restock with ease.",
  },
];

export const FOOTER_COLUMNS: {
  title: string;
  links: { label: string; href: string }[];
}[] = [
  {
    title: "For Retailers",
    links: [
      { label: "Browse Products", href: `#${SECTION_IDS.platform}` },
      { label: "How it Works", href: `#${SECTION_IDS.howItWorks}` },
      { label: "Pricing", href: `#${SECTION_IDS.platform}` },
      { label: "Help Center", href: `#${SECTION_IDS.join}` },
    ],
  },
  {
    title: "For Suppliers",
    links: [
      { label: "Sell on SoukCart", href: `#${SECTION_IDS.join}` },
      { label: "Supplier Guide", href: `#${SECTION_IDS.howItWorks}` },
      { label: "Pricing", href: `#${SECTION_IDS.platform}` },
      { label: "Resources", href: `#${SECTION_IDS.howItWorks}` },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About Us", href: `#${SECTION_IDS.platform}` },
      { label: "Careers", href: `#${SECTION_IDS.join}` },
      { label: "Blog", href: `#${SECTION_IDS.join}` },
      { label: "Contact Us", href: `#${SECTION_IDS.join}` },
    ],
  },
];

export const LEGAL_LINKS = [
  { label: "Privacy Policy", href: `#${SECTION_IDS.join}` },
  { label: "Terms of Service", href: `#${SECTION_IDS.join}` },
  { label: "Cookie Policy", href: `#${SECTION_IDS.join}` },
] as const;

/* Mirrors the placeholder feedback pattern already used across auth. */
export const NEWSLETTER_FEEDBACK =
  "Email updates will be available when the mailing list is connected.";
