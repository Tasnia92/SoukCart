import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "../../components/ui/Icon.tsx";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../../components/ui/sidebar";
import { AppShell, SidebarUser } from "../../components/ui/Workspace.tsx";

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

export function WorkspaceShell({
  navigationLabel,
  items,
  userName,
  userEmail,
  onLogout,
  children,
}: WorkspaceShellProps) {
  return (
    <AppShell
      sidebar={
        <Sidebar collapsible="none">
          <SidebarHeader>
            <RouterLink className="brand brand-dark" to="/" aria-label="SoukCart home">
              <img
                className="brand-logo"
                src="/soukcart-logo.png"
                alt=""
                width="1536"
                height="1024"
              />
              <span className="brand-word">SoukCart</span>
            </RouterLink>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <nav aria-label={navigationLabel}>
                <SidebarMenu>
                  {items.map(({ to, icon, label, active, trailing }) => (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton asChild isActive={active}>
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
            <SidebarUser userName={userName} userEmail={userEmail} />
            <Button variant="secondary" className="w-full" onClick={onLogout}>
              Log out
            </Button>
          </SidebarFooter>
        </Sidebar>
      }
    >
      {children}
    </AppShell>
  );
}
