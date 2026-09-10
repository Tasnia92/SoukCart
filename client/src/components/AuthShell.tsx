import type { ReactNode } from 'react'
import { Brand } from '@/components/Brand'
import { Store, Package } from 'lucide-react'

export function AuthShell({
  children,
  headline = 'Sell everywhere. Stay in sync.',
  body = 'Connect your storefronts, keep inventory accurate, and spend more time growing your business.',
}: {
  children: ReactNode
  headline?: string
  body?: string
}) {
  return (
    <div className="min-h-screen grid md:grid-cols-2 lg:grid-cols-[44%_56%] bg-[#f7f8f8]">
      <div className="relative flex flex-col px-6 py-8 md:px-10">
        <Brand />
        <div className="flex-1 flex items-center justify-center py-8">
          <div className="w-full max-w-[440px] rounded-2xl border border-border bg-white p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.04)]">
            {children}
          </div>
        </div>
      </div>
      <div className="relative hidden md:flex flex-col justify-between p-12 text-white">
        <img src="/login-bg.png" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover object-[62%_center]" />
        <div className="relative">
          <p className="text-xs font-semibold tracking-[0.12em] uppercase text-white/90">Why SoukCart</p>
          <h2 className="mt-3 text-4xl font-bold leading-tight tracking-tight text-balance max-w-md">{headline}</h2>
          <p className="mt-4 text-white/90 max-w-md text-[15px] leading-relaxed text-pretty">{body}</p>
        </div>
      </div>
    </div>
  )
}

export function RoleTabs({
  role,
  onChange,
}: {
  role: 'retailer' | 'supplier'
  onChange: (r: 'retailer' | 'supplier') => void
}) {
  return (
    <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-[#f1f3f3]">
      {([
        { id: 'retailer' as const, title: 'Retailer', sub: 'Buy for my shop', Icon: Store },
        { id: 'supplier' as const, title: 'Supplier', sub: 'Sell on SoukCart', Icon: Package },
      ]).map(({ id, title, sub, Icon }) => {
        const active = role === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={
              active
                ? 'rounded-full bg-white shadow-sm px-3 py-2.5 text-left border border-border/60'
                : 'rounded-full px-3 py-2.5 text-left text-muted'
            }
          >
            <span className="flex items-start gap-2">
              <Icon size={16} className={active ? 'text-primary mt-0.5' : 'mt-0.5'} />
              <span>
                <span className="block text-sm font-semibold text-foreground">{title}</span>
                <span className="block text-[11px] text-muted leading-tight">{sub}</span>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
