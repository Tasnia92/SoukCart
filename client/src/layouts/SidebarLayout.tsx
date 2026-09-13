import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Bell,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  PanelRight,
  PanelRightClose,
  type LucideIcon,
} from 'lucide-react'
import { Brand } from '@/components/Brand'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { applySidebarSide, cn, type SidebarSide } from '@/lib/utils'

export type SideNavItem = {
  to: string
  label: string
  Icon: LucideIcon
  end?: boolean
  badge?: number
}

export function SidebarLayout({
  items,
  roleLabel,
  notificationsTo,
  wide = false,
}: {
  items: SideNavItem[]
  roleLabel: 'Supplier' | 'Admin'
  notificationsTo: string
  bellCount?: number
  wide?: boolean
}) {
  const { user, logout } = useAuth()
  const { unread: bellCount } = useNotifications()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [side, setSide] = useState<SidebarSide>(() =>
    typeof document !== 'undefined' && document.documentElement.dataset.sidebar === 'right' ? 'right' : 'left',
  )
  const location = useLocation()

  useLayoutEffect(() => {
    setSide(applySidebarSide())
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const pageName = useMemo(() => {
    const hit = [...items].reverse().find((i) =>
      i.end ? location.pathname === i.to : location.pathname === i.to || location.pathname.startsWith(i.to + '/'),
    )
    return hit?.label || roleLabel
  }, [items, location.pathname, roleLabel])

  const collapseButton = (
    <button
      type="button"
      onClick={() => setCollapsed((c) => !c)}
      className="hidden md:inline-flex p-2 rounded-lg border border-border text-muted hover:bg-canvas"
      aria-label="Toggle sidebar"
    >
      {collapsed
        ? side === 'right'
          ? <PanelRight size={16} />
          : <PanelLeft size={16} />
        : side === 'right'
          ? <PanelRightClose size={16} />
          : <PanelLeftClose size={16} />}
    </button>
  )

  return (
    <div
      className="dash-shell"
      data-wide={wide ? 'true' : undefined}
      data-collapsed={collapsed ? 'true' : undefined}
    >
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={cn('dash-sidebar', mobileOpen && 'is-open')}>
        <div className={cn('px-2 mb-3', collapsed && 'md:px-0 md:flex md:justify-center')}>
          {!collapsed ? <Brand /> : <Brand className="hidden md:inline-flex" />}
          {collapsed && <Brand className="md:hidden" />}
          {!collapsed && (
            <p className="mt-3 text-[11px] font-semibold tracking-[0.14em] uppercase text-muted">{roleLabel}</p>
          )}
        </div>
        <nav className="flex flex-col gap-0.5 min-h-0 flex-1 overflow-y-auto">
          {items.map(({ to, label, Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              className={({ isActive }) =>
                cn(
                  'relative rounded-xl px-3 py-2.5 text-sm font-medium text-[#6b7280] hover:bg-nav-wash inline-flex items-center gap-2.5',
                  collapsed && 'md:justify-center md:px-2',
                  isActive && 'bg-nav-wash text-[#991B1B]',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={18} className={isActive ? 'text-[#991B1B]' : 'text-[#9ca3af]'} />
                  {(!collapsed || mobileOpen) && <span className={cn(collapsed && 'md:hidden')}>{label}</span>}
                  {!!badge && badge > 0 && (
                    <span className={cn('absolute rounded-full bg-danger text-white text-[10px] min-w-4 h-4 px-1 flex items-center justify-center', collapsed ? 'top-1 right-1' : 'right-2')}>
                      {badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className={cn('mt-auto border-t border-border pt-3', collapsed && 'md:flex md:justify-center')}>
          <button
            type="button"
            onClick={logout}
            title="Log out"
            className={cn(
              'w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-[#6b7280] hover:bg-nav-wash',
              collapsed && 'md:justify-center md:px-2',
            )}
          >
            <LogOut size={18} className="text-[#9ca3af]" />
            {(!collapsed || mobileOpen) && <span className={cn(collapsed && 'md:hidden')}>Log out</span>}
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex flex-col min-h-screen">
        <header className="h-14 bg-white border-b border-border flex items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-lg border border-border text-muted hover:bg-canvas md:hidden"
              aria-label="Open menu"
            >
              {side === 'right' ? <PanelRight size={16} /> : <PanelLeft size={16} />}
            </button>
            {side === 'left' ? collapseButton : null}
            <div className="text-muted">
              <span>{roleLabel}</span>
              <span className="mx-1.5">›</span>
              <span className="text-foreground font-medium">{pageName}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {side === 'right' ? collapseButton : null}
            <Link to={notificationsTo} className="relative p-2 text-muted hover:text-foreground">
              <Bell size={18} />
              {bellCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full bg-danger text-white text-[10px] flex items-center justify-center px-1">
                  {bellCount}
                </span>
              )}
            </Link>
          </div>
        </header>
        <main className="p-6 flex-1">
          {roleLabel === 'Supplier' && user?.verificationStatus && user.verificationStatus !== 'approved' && (
            <div className="mb-4 rounded-xl border border-[#f2ccc1] bg-[#fff4ef] px-4 py-3 text-sm">
              Supplier features are limited until admin approves your application.
              {' '}
              <Link to="/supplier/verification" className="font-medium text-primary">Submit or update verification →</Link>
              {user.verificationRejectReason ? <div className="text-danger mt-1">{user.verificationRejectReason}</div> : null}
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  )
}
