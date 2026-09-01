import { Link } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Icon, type IconName } from "../../components/ui/Icon.tsx";
import { AppShell } from "../../components/ui/Workspace.tsx";

export type WorkspacePath =
  | "/"
  | "/admin"
  | "/admin/users"
  | "/admin/activity"
  | "/admin/complaints"
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

type RouterLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
  params?: Record<string, string>;
};

// The code-generated route array currently merges sibling dynamic params in Link's type map.
// Keep the workaround here while retaining TanStack client navigation at every React workspace link.
export function RouterLink({ to, params = {}, ...props }: RouterLinkProps) {
  return <Link {...props} from={"/" as never} to={to as never} params={params as never} />;
}

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
        <aside className="admin-sidebar">
          <div className="admin-sidebar-top">
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
          </div>
          <nav className="admin-nav" aria-label={navigationLabel}>
            {items.map(({ to, icon, label, active, trailing }) => (
              <RouterLink
                className={`admin-tab${active ? " is-active" : ""}`}
                to={to}
                aria-current={active ? "page" : undefined}
                key={to}
              >
                <Icon name={icon} />
                <span>{label}</span>
                {trailing}
              </RouterLink>
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
      }
    >
      {children}
    </AppShell>
  );
}
