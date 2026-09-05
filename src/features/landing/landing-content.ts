/* -----------------------------------------------------------------------------
 * Landing page copy and link inventory.
 *
 * PLACEHOLDER DESTINATIONS: SoukCart has no marketing routes yet, so every
 * navigation and footer destination below points at an in-page section (or a
 * canonical profile URL pattern). Nothing is a dead `#` and nothing 404s — but
 * these hrefs are meant to be replaced once the real marketing pages exist.
 * The section ids are declared in LandingPage.tsx.
 * -------------------------------------------------------------------------- */

import {
  BadgePercentIcon,
  ClipboardListIcon,
  LayoutGridIcon,
  PackageCheckIcon,
  PackageIcon,
  ScaleIcon,
  SearchIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  ShoppingBagIcon,
  StoreIcon,
  TrendingUpIcon,
  TruckIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";

export const SECTION_IDS = {
  howItWorks: "how-it-works",
  forSuppliers: "for-suppliers",
  forRetailers: "for-retailers",
  join: "join",
} as const;

export const NAV_LINKS = [
  { label: "How It Works", href: `#${SECTION_IDS.howItWorks}` },
  { label: "For Suppliers", href: `#${SECTION_IDS.forSuppliers}` },
  { label: "For Retailers", href: `#${SECTION_IDS.forRetailers}` },
  { label: "Benefits", href: `#${SECTION_IDS.join}` },
  { label: "Pricing", href: `#${SECTION_IDS.join}` },
] as const;

export const HERO_POINTS: {
  icon: LucideIcon;
  title: string;
  copy: string;
}[] = [
  {
    icon: ShieldCheckIcon,
    title: "Verified Partners",
    copy: "Trusted & reliable network",
  },
  {
    icon: BadgePercentIcon,
    title: "Competitive Prices",
    copy: "Better deals, higher margins",
  },
  {
    icon: PackageCheckIcon,
    title: "Reliable Delivery",
    copy: "On-time, every time",
  },
];

export const SUPPLIER_SECTION = {
  icon: LayoutGridIcon,
  title: "For Suppliers",
} as const;

export const RETAILER_SECTION = {
  icon: ShoppingBagIcon,
  title: "For Retailers",
} as const;

export const SUPPLIER_STEPS: {
  icon: LucideIcon;
  step: string;
  title: string;
  copy: string;
}[] = [
  {
    icon: UserRoundIcon,
    step: "1",
    title: "Create Your Account",
    copy: "Sign up and set up your business profile.",
  },
  {
    icon: PackageIcon,
    step: "2",
    title: "List Your Products",
    copy: "Add products, prices, MOQs and availability.",
  },
  {
    icon: ShoppingCartIcon,
    step: "3",
    title: "Receive Orders",
    copy: "Retailers place orders directly from you.",
  },
  {
    icon: TruckIcon,
    step: "4",
    title: "Confirm Orders",
    copy: "Accept orders. Update delivery status for the retailer.",
  },
  {
    icon: TrendingUpIcon,
    step: "5",
    title: "Grow Your Business",
    copy: "Reach more retailers and grow your sales.",
  },
];

export const RETAILER_STEPS: {
  icon: LucideIcon;
  step: string;
  title: string;
  copy: string;
}[] = [
  {
    icon: SearchIcon,
    step: "1",
    title: "Find Products",
    copy: "Explore thousands of groceries from verified suppliers.",
  },
  {
    icon: ScaleIcon,
    step: "2",
    title: "Compare & Choose",
    copy: "Compare prices, MOQs and ratings to get the best deal.",
  },
  {
    icon: ClipboardListIcon,
    step: "3",
    title: "Place Your Order",
    copy: "Order in bulk with secure payment options.",
  },
  {
    icon: TruckIcon,
    step: "4",
    title: "Track & Receive",
    copy: "Watch delivery status as suppliers confirm and deliver your order.",
  },
  {
    icon: StoreIcon,
    step: "5",
    title: "Stock & Grow",
    copy: "Keep your shelves full and delight your customers.",
  },
];

export const FOOTER_COLUMNS: {
  title: string;
  links: { label: string; href: string }[];
}[] = [
  {
    title: "Platform",
    links: [
      { label: "How It Works", href: `#${SECTION_IDS.howItWorks}` },
      { label: "For Suppliers", href: `#${SECTION_IDS.forSuppliers}` },
      { label: "For Retailers", href: `#${SECTION_IDS.forRetailers}` },
      { label: "Benefits", href: `#${SECTION_IDS.join}` },
      { label: "Pricing", href: `#${SECTION_IDS.join}` },
      { label: "FAQ", href: `#${SECTION_IDS.howItWorks}` },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About Us", href: `#${SECTION_IDS.howItWorks}` },
      { label: "Careers", href: `#${SECTION_IDS.join}` },
      { label: "Blog", href: `#${SECTION_IDS.join}` },
      { label: "Contact Us", href: `#${SECTION_IDS.join}` },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of Use", href: `#${SECTION_IDS.join}` },
      { label: "Privacy Policy", href: `#${SECTION_IDS.join}` },
      { label: "Refund Policy", href: `#${SECTION_IDS.join}` },
    ],
  },
];

export const SOCIAL_LINKS = [
  { label: "SoukCart on Facebook", href: "https://facebook.com/soukcart" },
  { label: "SoukCart on LinkedIn", href: "https://linkedin.com/company/soukcart" },
  { label: "SoukCart on Instagram", href: "https://instagram.com/soukcart" },
] as const;

export const NEWSLETTER_FEEDBACK =
  "Email updates will be available when the mailing list is connected.";
