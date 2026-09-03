import type { ComponentPropsWithoutRef, InputHTMLAttributes, ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Brand } from "./Brand.tsx";
import { Icon, type IconName } from "./Icon.tsx";

export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <SidebarProvider>
      {sidebar}
      <SidebarInset className="min-w-0">
        <div className="flex items-center gap-2 border-b p-2 md:hidden">
          <SidebarTrigger />
        </div>
        <div className="mx-auto w-full max-w-[75rem] px-6 py-8 lg:px-12 lg:pb-16">{children}</div>
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

/**
 * User identity block shared by the anchor- and router-based sidebars. Semantic markup only,
 * no bespoke class contract: the name and email are the meaningful, asserted content.
 */
export function SidebarUser({ userName, userEmail }: { userName: string; userEmail: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-2 text-sm">
      <strong className="truncate">{userName}</strong>
      <small className="truncate text-muted-foreground">{userEmail}</small>
    </div>
  );
}

export function SidebarNav({ label, items, userName, userEmail, onLogout }: SidebarNavProps) {
  return (
    <Sidebar collapsible="none">
      <SidebarHeader>
        <Brand variant="dark" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <nav aria-label={label}>
            <SidebarMenu>
              {items.map(({ href, icon, label: itemLabel, active, trailing }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton asChild isActive={active}>
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
        <SidebarUser userName={userName} userEmail={userEmail} />
        <Button variant="secondary" className="w-full" onClick={onLogout}>
          Log out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}

type PageHeaderProps = {
  eyebrow: string;
  title: ReactNode;
  copy?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, copy, actions }: PageHeaderProps) {
  return (
    <header className="admin-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display-xl">{title}</h1>
        {copy ? <p>{copy}</p> : null}
      </div>
      {actions ? <div className="admin-header-actions">{actions}</div> : null}
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
    <div className="admin-toolbar">
      <InputGroup>
        <InputGroupAddon>
          <Icon name="search" />
        </InputGroupAddon>
        <InputGroupInput {...inputProps} type="search" aria-label={label} />
      </InputGroup>
      <span className="admin-result-count">{result}</span>
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
  return (
    <div className="mt-4 min-h-5">
      {message ? (
        <Alert
          role="status"
          aria-live="polite"
          variant={state === "error" ? "destructive" : "default"}
        >
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
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
