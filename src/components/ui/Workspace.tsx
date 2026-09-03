import type {
  ComponentPropsWithoutRef,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Brand } from "./Brand.tsx";
import { Icon, type IconName } from "./Icon.tsx";

export function AppShell({
  sidebar,
  header,
  children,
}: {
  sidebar: ReactNode;
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "16rem",
          "--header-height": "3rem",
        } as CSSProperties
      }
    >
      {sidebar}
      <SidebarInset className="min-w-0">
        {header ?? (
          <div className="flex h-(--header-height) items-center gap-2 border-b px-3 md:hidden">
            <SidebarTrigger />
          </div>
        )}
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export type SidebarItem = {
  href: string;
  icon: IconName;
  label: string;
  active?: boolean;
  trailing?: ReactNode;
};

type SidebarNavProps = {
  label: string;
  items: SidebarItem[];
  userName: string;
  userEmail: string;
  onLogout: () => void;
};

function initials(value: string): string {
  const result = value
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return result || "U";
}

/**
 * User identity block shared by the anchor- and router-based sidebars. Semantic markup only,
 * no bespoke class contract: the name and email are the meaningful, asserted content.
 */
export function SidebarUser({ userName, userEmail }: { userName: string; userEmail: string }) {
  return (
    <div className="grid flex-1 text-left text-sm leading-tight">
      <strong className="truncate font-medium">{userName}</strong>
      <small className="truncate text-xs font-normal text-muted-foreground">{userEmail}</small>
    </div>
  );
}

export function NavUser({
  userName,
  userEmail,
  onLogout,
}: {
  userName: string;
  userEmail: string;
  onLogout: () => void;
}) {
  const { isMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label="Account menu"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="rounded-lg">
                <AvatarFallback className="rounded-lg">{initials(userName)}</AvatarFallback>
              </Avatar>
              <SidebarUser userName={userName} userEmail={userEmail} />
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="rounded-lg">
                  <AvatarFallback className="rounded-lg">{initials(userName)}</AvatarFallback>
                </Avatar>
                <SidebarUser userName={userName} userEmail={userEmail} />
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onLogout}>
                <LogOut />
                Log out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function SidebarNav({ label, items, userName, userEmail, onLogout }: SidebarNavProps) {
  return (
    <Sidebar collapsible="none" className="border-r">
      <SidebarHeader>
        <Brand />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <nav aria-label={label}>
            <SidebarMenu>
              {items.map(({ href, icon, label: itemLabel, active, trailing }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton asChild isActive={active} tooltip={itemLabel}>
                    <a href={href} aria-current={active ? "page" : undefined}>
                      <Icon name={icon} />
                      <span>{itemLabel}</span>
                    </a>
                  </SidebarMenuButton>
                  {trailing ? <SidebarMenuBadge>{trailing}</SidebarMenuBadge> : null}
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
  );
}

type PageHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  copy?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, copy, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {copy ? <p className="max-w-2xl text-sm text-muted-foreground">{copy}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function StatGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="admin-stats" aria-label={label}>
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <Card className="min-h-32 gap-2 border-0 bg-muted py-6 shadow-none">
      <CardHeader className="gap-1">
        <CardDescription className="text-xs font-medium tracking-widest uppercase">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <CardTitle className="text-3xl">{value}</CardTitle>
        {detail ? <CardDescription>{detail}</CardDescription> : null}
      </CardContent>
    </Card>
  );
}

type SearchToolbarProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  result: ReactNode;
};

export function SearchToolbar({ label, result, ...inputProps }: SearchToolbarProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <InputGroup className="max-w-sm">
        <InputGroupAddon>
          <Icon name="search" />
        </InputGroupAddon>
        <InputGroupInput {...inputProps} type="search" aria-label={label} />
      </InputGroup>
      <span className="text-sm whitespace-nowrap text-muted-foreground">{result}</span>
    </div>
  );
}

export function TableShell({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      className={["overflow-hidden rounded-xl border bg-card", className].filter(Boolean).join(" ")}
    />
  );
}

export type NoticeState = "info" | "success" | "error";

export function InlineNotice({
  message,
  state = "info",
}: {
  message?: string;
  state?: NoticeState;
}) {
  if (!message) return null;
  return (
    <Alert role="status" aria-live="polite" variant={state === "error" ? "destructive" : "default"}>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

type EmptyStateProps = {
  icon: IconName;
  title: ReactNode;
  copy?: ReactNode;
  action?: ReactNode;
  role?: "status";
};

export function EmptyState({ icon, title, copy, action, role }: EmptyStateProps) {
  return (
    <Empty role={role} aria-live={role ? "polite" : undefined}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon name={icon} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {copy ? <EmptyDescription>{copy}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

export function LoadingState({ title, copy }: { title: ReactNode; copy?: ReactNode }) {
  return (
    <Empty role="status" aria-live="polite">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Skeleton className="size-6 rounded-full" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {copy ? <EmptyDescription>{copy}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}

type WorkspaceErrorProps = {
  eyebrow: string;
  title: ReactNode;
  message: ReactNode;
  onRetry: () => void;
  onLogout: () => void;
};

export function WorkspaceError({
  eyebrow,
  title,
  message,
  onRetry,
  onLogout,
}: WorkspaceErrorProps) {
  return (
    <div className="admin-error-screen">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="display-lg">{title}</h1>
      <p>{message}</p>
      <div className="admin-error-actions">
        <Button onClick={onRetry}>Try again</Button>
        <Button variant="ghost" onClick={onLogout}>
          Log out
        </Button>
      </div>
    </div>
  );
}
