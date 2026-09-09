import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, Menu, ShoppingCart, Search, Home, Package, Truck, LifeBuoy, UserRound, X } from 'lucide-react'
import { Brand } from '@/components/Brand'
import { useCart } from '@/context/CartContext'
import { useNotifications } from '@/context/NotificationContext'
import { cn } from '@/lib/utils'

const nav = [
  { to: '/retailer/products', label: 'Home', Icon: Home },
  { to: '/retailer/orders', label: 'Orders', Icon: Package },
  { to: '/retailer/tracking', label: 'Tracking', Icon: Truck },
  { to: '/retailer/help', label: 'Help Center', Icon: LifeBuoy },
  { to: '/retailer/settings', label: 'Account', Icon: UserRound },
]

function SearchField({ className = '' }: { className?: string }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  useEffect(() => {
    setQ(params.get('q') || '')
  }, [params])
  function go(e: FormEvent) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget as HTMLFormElement)
    const next = String(fd.get('q') || q).trim()
    navigate(next ? `/retailer/products?q=${encodeURIComponent(next)}` : '/retailer/products')
  }
  return (
    <form onSubmit={go} className={cn('flex-1 max-w-xl relative', className)}>
      <input
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search products, suppliers..."
        className="w-full h-11 rounded-full bg-[#f7f8f8] border border-border pl-4 pr-11 text-base sm:text-sm"
        aria-label="Search products"
      />
      <button type="submit" className="absolute right-4 top-1/2 -translate-y-1/2 text-muted" aria-label="Search">
        <Search size={16} />
      </button>
    </form>
  )
}

export function RetailerLayout() {
  const { count } = useCart()
  const { unread } = useNotifications()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Lock body scroll + close on Escape while the mobile drawer is open
  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [drawerOpen])

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between gap-4 relative">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="md:hidden p-2 -ml-2 rounded-lg text-foreground hover:bg-canvas"
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <Menu size={20} />
            </button>
            <Brand to="/retailer/products" />
          </div>

          {/* Desktop nav — centered in the header */}
          <nav className="hidden md:flex items-center gap-1 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            {nav.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'px-3 py-1.5 rounded-full text-sm font-medium inline-flex items-center gap-2 text-muted hover:text-foreground hover:bg-canvas transition-colors',
                    isActive && 'bg-primary text-white hover:text-white hover:bg-primary',
                  )
                }
              >
                <Icon size={15} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-4 text-sm">
            <Link to="/retailer/notifications" className="relative flex flex-col items-center gap-0.5 text-muted hover:text-foreground">
              <span className="relative">
                <Bell size={18} />
                {unread > 0 && (
                  <span className="absolute -top-1.5 -right-2 h-4 min-w-4 rounded-full bg-danger text-white text-[10px] flex items-center justify-center px-1 tabular-nums">{unread > 99 ? '99+' : unread}</span>
                )}
              </span>
              <span className="text-[11px]">Notifications</span>
            </Link>
            <Link to="/retailer/cart" className="relative flex flex-col items-center gap-0.5 text-muted hover:text-foreground">
              <span className="relative">
                <ShoppingCart size={18} />
                {count > 0 && (
                  <span className="absolute -top-1.5 -right-2 h-4 min-w-4 rounded-full bg-primary text-white text-[10px] flex items-center justify-center px-1 tabular-nums">{count}</span>
                )}
              </span>
              <span className="text-[11px]">Cart</span>
            </Link>
          </div>
        </div>

        {/* Search — centered below the header on all screens */}
        <div className="px-4 pb-3">
          <SearchField className="mx-auto" />
        </div>
      </header>

      {/* Mobile navigation drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <aside className="absolute left-0 top-0 bottom-0 w-72 max-w-[80vw] bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <Brand to="/retailer/products" />
              <button
                type="button"
                className="p-2 -mr-2 rounded-lg text-foreground hover:bg-canvas"
                aria-label="Close navigation menu"
                onClick={() => setDrawerOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <nav className="flex flex-col gap-1 p-3">
              {nav.map(({ to, label, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setDrawerOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted hover:bg-canvas',
                      isActive && 'bg-[#f2ccc1] text-foreground hover:bg-[#f2ccc1]',
                    )
                  }
                >
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}
            </nav>
          </aside>
        </div>
      )}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
        <Outlet />
      </main>
      <footer className="bg-[#f9fafb] border-t border-border mt-8">
        <div className="mx-auto max-w-6xl px-4 py-10 grid md:grid-cols-4 gap-6 text-sm">
          <div>
            <Brand to="/retailer/products" />
            <p className="mt-3 text-muted text-[13px]">Stock up from verified suppliers. Track orders. Grow your shop.</p>
          </div>
          <div>
            <div className="font-semibold mb-2">Shop</div>
            <ul className="space-y-1.5 text-muted">
              <li><Link to="/retailer/products">Home</Link></li>
              <li><Link to="/retailer/products">Products</Link></li>
              <li><Link to="/retailer/cart">Cart</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-2">Orders</div>
            <ul className="space-y-1.5 text-muted">
              <li><Link to="/retailer/orders">Orders</Link></li>
              <li><Link to="/retailer/tracking">Tracking</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-2">Support</div>
            <ul className="space-y-1.5 text-muted">
              <li><Link to="/retailer/help">Help Center</Link></li>
              <li><Link to="/retailer/settings">Settings</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 h-12 flex items-center text-[13px] text-muted">
            © 2026 SoukCart. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}
