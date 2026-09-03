import type { ReactNode } from "react";
import { Icon, type IconName } from "../../components/ui/Icon.tsx";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { AppShell, NavUser } from "../../components/ui/Workspace.tsx";
import { NotificationsBell } from "../notifications/NotificationsPanel.tsx";

// Re-exported so the many existing `from "../workspace/WorkspaceShell.tsx"` imports keep working
// while shared UI primitives import the link from the component layer instead.
export { RouterLink };

export type WorkspacePath =
  | "/"
  | "/admin"
  | "/admin/users"
  | "/admin/activity"
  | "/admin/complaints"
  | "/admin/verifications"
  | "/retailer"
  | "/retailer/catalog"
  | "/retailer/cart"
  | "/retailer/orders"
  | "/retailer/complaints"
  | "/supplier"
  | "/supplier/orders"
  | "/supplier/products"
  | "/supplier/stock";

export type WorkspaceNavItem = {
  to: WorkspacePath;
  icon: IconName;
  label: string;
  active?: boolean;
  trailing?: ReactNode;
};

type WorkspaceShellProps = {
  navigationLabel: string;
  items: WorkspaceNavItem[];
  userName: string;
  userEmail: string;
  onLogout: () => void;
  children: ReactNode;
};

function workspaceRole(items: WorkspaceNavItem[]): { label: string; home: WorkspacePath } {
  const home = items[0]?.to ?? "/";
  if (home.startsWith("/admin")) return { label: "Admin", home: "/admin" };
  if (home.startsWith("/retailer")) return { label: "Retailer", home: "/retailer" };
  if (home.startsWith("/supplier")) return { label: "Seller", home: "/supplier" };
  return { label: "Workspace", home: "/" };
}

export function WorkspaceShell({
  navigationLabel,
  items,
  userName,
  userEmail,
  onLogout,
  children,
}: WorkspaceShellProps) {
  const role = workspaceRole(items);
  const current = items.find((item) => item.active);

  return (
    <AppShell
      sidebar={
        <Sidebar collapsible="none" className="border-r">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" asChild>
                  <RouterLink to="/" aria-label="SoukCart home">
                    <img
                      src="/soukcart-logo.png"
                      alt=""
                      width="32"
                      height="32"
                      className="size-8 object-contain"
                    />
                    <span className="text-base font-semibold">SoukCart</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>{role.label}</SidebarGroupLabel>
              <nav aria-label={navigationLabel}>
                <SidebarMenu>
                  {items.map(({ to, icon, label, active, trailing }) => (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={label}>
                        <RouterLink to={to} aria-current={active ? "page" : undefined}>
                          <Icon name={icon} />
                          <span>{label}</span>
                        </RouterLink>
                      </SidebarMenuButton>
                      {trailing ? (
                        <SidebarMenuBadge className="rt-nav-badge">{trailing}</SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </nav>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <NavUser userName={userName} userEmail={userEmail} onLogout={onLogout} />
          </SidebarFooter>
        </Sidebar>
      }
      header={
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b px-4">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                {current && current.to !== role.home ? (
                  <BreadcrumbLink asChild>
                    <RouterLink to={role.home}>{role.label}</RouterLink>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{role.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {current ? (
                <>
                  <BreadcrumbSeparator className="hidden md:block" />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{current.label}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              ) : null}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-1">
            <NotificationsBell />
          </div>
        </header>
      }
    >
      {children}
    </AppShell>
  );
}
