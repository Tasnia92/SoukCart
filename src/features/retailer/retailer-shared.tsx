import type { ReactNode } from "react";
import {
  Home,
  LogOut,
  Menu,
  MessageSquare,
  Package,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import { Separator } from "../../components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../../components/ui/sheet";
import { NotificationsBell } from "../notifications/NotificationsPanel.tsx";

export type RetailerSection =
  | "storefront"
  | "catalog"
  | "cart"
  | "checkout"
  | "orders"
  | "tracking"
  | "complaints"
  | "notifications"
  | "settings";

export type RetailerNavBadges = {
  cartCount?: number;
  unreadNotifications?: number;
  inTransitCount?: number;
};

type RetailerNavItem = {
  to: string;
  icon: LucideIcon;
  label: string;
  active?: boolean;
  badge?: number;
};

type RetailerNav = {
  primary: RetailerNavItem[];
  account: RetailerNavItem[];
};

function buildRetailerNav(section: RetailerSection, badges: RetailerNavBadges): RetailerNav {
  return {
    primary: [
      {
        to: "/retailer",
        icon: Home,
        label: "Home",
        active: section === "storefront",
      },
      {
        to: "/retailer/catalog",
        icon: ShoppingBag,
        label: "Products",
        active: section === "catalog",
      },
      {
        to: "/retailer/cart",
        icon: ShoppingCart,
        label: "Cart",
        active: section === "cart" || section === "checkout",
        badge: badges.cartCount || 0,
      },
      {
        to: "/retailer/orders",
        icon: Package,
        label: "Orders",
        active: section === "orders",
      },
      {
        to: "/retailer/tracking",
        icon: Truck,
        label: "Tracking",
        active: section === "tracking",
        badge: badges.inTransitCount || 0,
      },
    ],
    account: [
      {
        to: "/retailer/complaints",
        icon: MessageSquare,
        label: "Help Center",
        active: section === "complaints",
      },
      {
        // The account item opens the settings screen, where log out lives.
        to: "/retailer/settings",
        icon: Settings,
        label: "Account",
        active: section === "settings",
      },
    ],
  };
}

export type RetailerWorkspaceShellProps = {
  section: RetailerSection;
  /** Kept for call-site compatibility; the storefront header shows only the bell. */
  userName: string;
  userEmail: string;
  cartCount?: number;
  unreadNotifications?: number;
  inTransitCount?: number;
  /** Optional page-owned search box, hosted in the header's center slot. */
  search?: ReactNode;
  onLogout: () => void;
  children: ReactNode;
};

/**
 * The retailer storefront chrome: a traditional shop layout instead of the
 * workspace sidebar — logo, centered search and account/cart icons on top, a
 * dark nav strip under them, the page in the middle, and a quiet footer.
 * Shared by every retailer page so the chrome never changes underneath the
 * content.
 */
export function RetailerWorkspaceShell({
  section,
  cartCount = 0,
  unreadNotifications = 0,
  inTransitCount = 0,
  search,
  onLogout,
  children,
}: RetailerWorkspaceShellProps) {
  const nav = buildRetailerNav(section, { cartCount, unreadNotifications, inTransitCount });

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <RetailerHeader nav={nav} cartCount={cartCount} search={search} onLogout={onLogout} />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 print:max-w-none print:p-0">
        {children}
      </main>
      <RetailerFooter />
    </div>
  );
}

function CountPill({ value }: { value: number }) {
  return (
    <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
      {value}
    </span>
  );
}

function BrandLogo({ className }: { className?: string }) {
  return (
    <RouterLink
      to="/"
      aria-label="SoukCart home"
      className={
        "inline-flex items-center gap-2.5 font-heading text-xl font-semibold tracking-tight text-foreground no-underline " +
        (className ?? "")
      }
    >
      <img
        src="/soukcart-logo.png"
        alt=""
        width={36}
        height={36}
        className="size-9 shrink-0 object-contain lg:size-11"
      />
      <span>soukcart</span>
    </RouterLink>
  );
}

function NavRow({ item }: { item: RetailerNavItem }) {
  return (
    <SheetClose asChild>
      <RouterLink
        to={item.to}
        aria-current={item.active ? "page" : undefined}
        className={
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
          (item.active
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground")
        }
      >
        <item.icon className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">{item.label}</span>
        {item.badge ? <CountPill value={item.badge} /> : null}
      </RouterLink>
    </SheetClose>
  );
}

function RetailerMobileMenu({ nav, onLogout }: { nav: RetailerNav; onLogout: () => void }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation menu">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-72 flex-col gap-0 overflow-y-auto p-0">
        <SheetHeader className="border-b px-4 py-4 text-left">
          <SheetTitle className="flex items-center gap-2.5 font-heading text-xl font-semibold tracking-tight">
            <img
              src="/soukcart-logo.png"
              alt=""
              width={36}
              height={36}
              className="size-9 object-contain"
            />
            soukcart
          </SheetTitle>
          <SheetDescription className="sr-only">Retailer navigation</SheetDescription>
        </SheetHeader>
        <nav className="flex flex-col gap-1 p-3" aria-label="Retailer">
          {nav.primary.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
        </nav>
        <Separator />
        <nav className="flex flex-col gap-1 p-3" aria-label="Account">
          {nav.account.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
        </nav>
        <div className="mt-auto border-t p-3">
          <SheetClose asChild>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-sm font-medium text-muted-foreground hover:text-foreground"
              onClick={onLogout}
            >
              <LogOut className="size-4" aria-hidden="true" />
              Log out
            </Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Labeled cart icon (top-right) with the live item count. */
function CartButton({ count }: { count: number }) {
  return (
    <RouterLink
      to="/retailer/cart"
      aria-label={count ? `Cart, ${count} items` : "Cart"}
      className="relative flex flex-col items-center gap-0.5 rounded-md px-2 py-1 text-[10px] font-medium text-foreground/70 transition-colors hover:text-foreground"
    >
      <ShoppingCart className="size-5" aria-hidden="true" />
      Cart
      {count ? (
        <span className="absolute top-0 right-0 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
          {count}
        </span>
      ) : null}
    </RouterLink>
  );
}

function BarNavLink({ item }: { item: RetailerNavItem }) {
  return (
    <RouterLink
      to={item.to}
      aria-current={item.active ? "page" : undefined}
      className={
        "relative flex h-full shrink-0 items-center gap-1.5 text-sm font-medium transition-colors " +
        (item.active
          ? "text-primary-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary-foreground/90"
          : "text-primary-foreground/70 hover:text-primary-foreground")
      }
    >
      <item.icon className="size-4 shrink-0" aria-hidden="true" />
      {item.label}
      {item.badge ? (
        <span className="ml-1.5 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
          {item.badge}
        </span>
      ) : null}
    </RouterLink>
  );
}

function RetailerHeader({
  nav,
  cartCount,
  search,
  onLogout,
}: {
  nav: RetailerNav;
  cartCount: number;
  search?: ReactNode;
  onLogout: () => void;
}) {
  // The cart lives in the top-right icon cluster, so the dark strip shows the
  // rest: products, orders, tracking, plus the account pages.
  const barItems: RetailerNavItem[] = [
    ...nav.primary.filter((item) => item.to !== "/retailer/cart"),
    ...nav.account,
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur print:hidden supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:h-20 lg:px-8">
        <div className="flex min-w-0 items-center gap-1">
          <RetailerMobileMenu nav={nav} onLogout={onLogout} />
          <BrandLogo />
        </div>

        {search ? (
          <div className="hidden min-w-0 flex-1 justify-center lg:flex">
            <div className="w-full max-w-xl">{search}</div>
          </div>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <NotificationsBell viewAllTo="/retailer/notifications" />
          <CartButton count={cartCount} />
        </div>
      </div>

      {search ? (
        <div className="border-t px-4 py-2 sm:px-6 lg:hidden">
          <div className="mx-auto max-w-xl">{search}</div>
        </div>
      ) : null}

      <div className="hidden bg-primary text-primary-foreground lg:block">
        <div className="mx-auto flex h-11 max-w-7xl items-stretch px-4 sm:px-6 lg:justify-center lg:px-8">
          <nav className="flex items-stretch gap-5 overflow-x-auto lg:gap-8" aria-label="Retailer">
            {barItems.map((item) => (
              <BarNavLink key={item.to} item={item} />
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}

function FooterColumn({ title, items }: { title: string; items: { to: string; label: string }[] }) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.to}>
            <RouterLink
              to={item.to}
              className="text-sm text-muted-foreground no-underline transition-colors hover:text-foreground"
            >
              {item.label}
            </RouterLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RetailerFooter() {
  return (
    <footer className="border-t bg-muted/40 print:hidden">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="space-y-3">
            <BrandLogo />
            <p className="max-w-xs text-sm text-muted-foreground">
              Stock up from verified suppliers, follow every delivery, and settle payments — all in
              one place.
            </p>
          </div>
          <FooterColumn
            title="Shop"
            items={[
              { to: "/retailer", label: "Home" },
              { to: "/retailer/catalog", label: "Products" },
              { to: "/retailer/cart", label: "Cart" },
            ]}
          />
          <FooterColumn
            title="Orders"
            items={[
              { to: "/retailer/orders", label: "Orders" },
              { to: "/retailer/tracking", label: "Tracking" },
            ]}
          />
          <FooterColumn
            title="Support"
            items={[
              { to: "/retailer/complaints", label: "Help Center" },
              { to: "/retailer/settings", label: "Settings" },
            ]}
          />
        </div>
        <Separator className="my-6" />
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} SoukCart. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
