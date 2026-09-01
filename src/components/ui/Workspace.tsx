import type { ComponentPropsWithoutRef, InputHTMLAttributes, ReactNode } from "react";
import { Brand } from "./Brand.tsx";
import { Button } from "./Button.tsx";
import { Icon, type IconName } from "./Icon.tsx";

export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="admin-layout">
      {sidebar}
      <main className="admin-main min-w-0">{children}</main>
    </div>
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

export function SidebarNav({ label, items, userName, userEmail, onLogout }: SidebarNavProps) {
  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-top">
        <Brand variant="dark" />
      </div>
      <nav className="admin-nav" aria-label={label}>
        {items.map(({ href, icon, label: itemLabel, active, trailing }) => (
          <a
            className={`admin-tab${active ? " is-active" : ""}`}
            href={href}
            aria-current={active ? "page" : undefined}
            key={href}
          >
            <Icon name={icon} />
            <span>{itemLabel}</span>
            {trailing}
          </a>
        ))}
      </nav>
      <div className="admin-sidebar-footer">
        <div className="admin-user">
          <span className="admin-user-info">
            <strong>{userName}</strong>
            <small>{userEmail}</small>
          </span>
        </div>
        <Button variant="secondary" block onClick={onLogout}>
          Log out
        </Button>
      </div>
    </aside>
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
    <article className="admin-stat">
      <p className="admin-stat-label">{label}</p>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

type SearchToolbarProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  result: ReactNode;
};

export function SearchToolbar({ label, result, ...inputProps }: SearchToolbarProps) {
  return (
    <div className="admin-toolbar">
      <label className="admin-search">
        <Icon name="search" />
        <span className="sr-only">{label}</span>
        <input {...inputProps} type="search" />
      </label>
      <span className="admin-result-count">{result}</span>
    </div>
  );
}

export function TableShell({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={["admin-table-wrap", className].filter(Boolean).join(" ")} />;
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
    <p
      className={`admin-notice${message ? ` is-visible is-${state}` : ""}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </p>
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
    <div className="rt-empty-card" role={role} aria-live={role ? "polite" : undefined}>
      <span className="rt-empty-icon">
        <Icon name={icon} />
      </span>
      <strong>{title}</strong>
      {copy ? <span>{copy}</span> : null}
      {action}
    </div>
  );
}

export function LoadingState({ title, copy }: { title: ReactNode; copy?: ReactNode }) {
  return <EmptyState icon="clock" title={title} copy={copy} role="status" />;
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
        <Button variant="subtle" onClick={onLogout}>
          Log out
        </Button>
      </div>
    </div>
  );
}
