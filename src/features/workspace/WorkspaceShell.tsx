import type { ReactNode } from "react";
import { ChevronRight, ChevronsUpDown, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { AppShell, NavUser } from "../../components/ui/Workspace.tsx";
import { NotificationsBell } from "../notifications/NotificationsPanel.tsx";

export { RouterLink };

export type WorkspacePath =
  | "/"
  | "/admin"
  | "/admin/inbox/urgent"
  | "/admin/inbox/queue"
  | "/admin/users"
  | "/admin/activity"
  | "/admin/complaints"
  | "/admin/payouts"
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

export type WorkspaceNavMenuChoice = {
  id: string;
  label: string;
  icon?: LucideIcon;
  to?: WorkspacePath;
  search?: Record<string, string>;
  active?: boolean;
};

export type WorkspaceNavItem = {
  to?: WorkspacePath;
  icon: LucideIcon;
  label: string;
  active?: boolean;
  trailing?: ReactNode;
  menu?: readonly WorkspaceNavMenuChoice[];
  onSelect?: (id: string) => void;
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
  const home = items.find((item) => item.to)?.to ?? "/";
  if (home.startsWith("/admin")) return { label: "Admin", home: "/admin" };
  if (home.startsWith("/retailer")) return { label: "Retailer", home: "/retailer" };
  if (home.startsWith("/supplier")) return { label: "Seller", home: "/supplier" };
  return { label: "Workspace", home: "/" };
}

function NavChoiceLabel({ choice }: { choice: WorkspaceNavMenuChoice }) {
  const Icon = choice.icon;
  return (
    <>
      {Icon ? <Icon /> : null}
      <span>{choice.label}</span>
    </>
  );
}

function WorkspaceNavLink({ item }: { item: WorkspaceNavItem }) {
  const to = item.to;
  if (!to) return null;
  const ItemIcon = item.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={item.active}>
        <RouterLink to={to} aria-current={item.active ? "page" : undefined} title={item.label}>
          <ItemIcon />
          <span>{item.label}</span>
        </RouterLink>
      </SidebarMenuButton>
      {item.trailing ? (
        <SidebarMenuBadge className="rt-nav-badge bg-primary text-primary-foreground">
          {item.trailing}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

function WorkspaceNavFlyout({ item }: { item: WorkspaceNavItem }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const ItemIcon = item.icon;
  const choices = item.menu ?? [];

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            isActive={item.active}
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            aria-label={item.label}
            title={item.label}
          >
            <ItemIcon />
            <span>{item.label}</span>
            <ChevronsUpDown className="ml-auto" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="min-w-56"
          side={isMobile ? "bottom" : "right"}
          align="start"
          sideOffset={4}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
            {choices.map((choice) =>
              choice.to ? (
                <DropdownMenuItem key={choice.id} asChild>
                  <RouterLink
                    to={choice.to}
                    search={choice.search}
                    onClick={() => {
                      if (isMobile) setOpenMobile(false);
                    }}
                  >
                    <NavChoiceLabel choice={choice} />
                  </RouterLink>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  key={choice.id}
                  onClick={() => {
                    if (isMobile) setOpenMobile(false);
                    item.onSelect?.(choice.id);
                  }}
                >
                  <NavChoiceLabel choice={choice} />
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {item.trailing ? (
        <SidebarMenuBadge className="rt-nav-badge bg-primary text-primary-foreground">
          {item.trailing}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

function WorkspaceNavDropdown({ item }: { item: WorkspaceNavItem }) {
  const { isMobile, setOpenMobile, state } = useSidebar();
  const ItemIcon = item.icon;
  const choices = item.menu ?? [];

  if (state === "collapsed" && !isMobile) {
    return <WorkspaceNavFlyout item={item} />;
  }

  return (
    <SidebarMenuItem>
      <Collapsible defaultOpen={item.active} className="group/collapsible">
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={item.active} aria-label={item.label} title={item.label}>
            <ItemIcon />
            <span>{item.label}</span>
            <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {choices.map((choice) => (
              <SidebarMenuSubItem key={choice.id}>
                {choice.to ? (
                  <SidebarMenuSubButton asChild isActive={choice.active}>
                    <RouterLink
                      to={choice.to}
                      search={choice.search}
                      aria-current={choice.active ? "page" : undefined}
                      onClick={() => {
                        if (isMobile) setOpenMobile(false);
                      }}
                    >
                      <NavChoiceLabel choice={choice} />
                    </RouterLink>
                  </SidebarMenuSubButton>
                ) : (
                  <SidebarMenuSubButton
                    isActive={choice.active}
                    onClick={() => {
                      if (isMobile) setOpenMobile(false);
                      item.onSelect?.(choice.id);
                    }}
                  >
                    <NavChoiceLabel choice={choice} />
                  </SidebarMenuSubButton>
                )}
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
      {item.trailing ? (
        <SidebarMenuBadge className="rt-nav-badge bg-primary text-primary-foreground">
          {item.trailing}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

function WorkspaceNavList({
  items,
  navigationLabel,
}: {
  items: WorkspaceNavItem[];
  navigationLabel: string;
}) {
  return (
    <nav aria-label={navigationLabel}>
      <SidebarMenu>
        {items.map((item) =>
          item.menu ? (
            <WorkspaceNavDropdown key={item.label} item={item} />
          ) : (
            <WorkspaceNavLink key={item.to ?? item.label} item={item} />
          ),
        )}
      </SidebarMenu>
    </nav>
  );
}

function WorkspaceBreadcrumb({ items }: { items: WorkspaceNavItem[] }) {
  const role = workspaceRole(items);
  const parent = items.find((item) => item.active);
  const child = parent?.menu?.find((choice) => choice.active);
  const showParent = Boolean(parent && parent.to !== role.home);
  const parentTo = parent?.to && parent.to !== role.home ? parent.to : null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="hidden sm:block">
          {showParent ? (
            <BreadcrumbLink asChild>
              <RouterLink to={role.home}>{role.label}</RouterLink>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>{role.label}</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {showParent && parent ? (
          <>
            <BreadcrumbSeparator className="hidden sm:block" />
            <BreadcrumbItem>
              {child && parentTo ? (
                <BreadcrumbLink asChild>
                  <RouterLink to={parentTo}>{parent.label}</RouterLink>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{parent.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </>
        ) : null}
        {showParent && child ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{child.label}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : null}
      </BreadcrumbList>
    </Breadcrumb>
  );
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
              <WorkspaceNavList items={items} navigationLabel={navigationLabel} />
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
          <WorkspaceBreadcrumb items={items} />
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
