import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
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
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppShell, NavUser } from "../../components/ui/Workspace.tsx";
import { NotificationsBell } from "../notifications/NotificationsPanel.tsx";

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
  icon: LucideIcon;
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
        <Sidebar collapsible="icon">
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
                    <span className="font-heading text-base font-semibold">SoukCart</span>
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
                  {items.map(({ to, icon: ItemIcon, label, active, trailing }) => (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton asChild isActive={active}>
                        <RouterLink
                          to={to}
                          aria-current={active ? "page" : undefined}
                          title={label}
                        >
                          <ItemIcon />
                          <span>{label}</span>
                        </RouterLink>
                      </SidebarMenuButton>
                      {trailing ? (
                        <SidebarMenuBadge className="bg-primary text-primary-foreground">
                          {trailing}
                        </SidebarMenuBadge>
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
          <SidebarRail />
        </Sidebar>
      }
      header={
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden sm:block">
                {current && current.to !== role.home ? (
                  <BreadcrumbLink asChild>
                    <RouterLink to={role.home}>{role.label}</RouterLink>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{role.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {current && current.to !== role.home ? (
                <>
                  <BreadcrumbSeparator className="hidden sm:block" />
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
