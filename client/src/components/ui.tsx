import { ArrowDownRight, ArrowUpRight, Inbox, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode } from 'react'

/**
 * Dropdown anchored to a trigger button. The menu is rendered with `position: fixed`
 * and flips upward when there is not enough room below the trigger, so it is never
 * clipped by nearby `overflow-hidden` containers and can always be clicked.
 */
export function DropdownMenu({
  button,
  children,
  align = 'right',
}: {
  button: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const itemCount = (Array.isArray(children) ? children : [children]).filter(Boolean).length
  const menuHeight = Math.min(itemCount, 6) * 32 + 16

  useEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const btn = triggerRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const gap = 6
    const menuWidth = 170
    const topBelow = r.bottom + gap
    const topAbove = r.top - gap - menuHeight
    const fitsBelow = window.innerHeight - topBelow >= menuHeight
    const fitsAbove = topAbove >= 0
    const top = fitsBelow || !fitsAbove ? topBelow : topAbove
    const left = align === 'right' ? Math.max(8, r.right - menuWidth) : Math.max(8, r.left)
    const viewport = window.visualViewport?.width ?? window.innerWidth
    setPos({ top, left: align === 'right' ? Math.min(left, viewport - menuWidth - 8) : left })
  }, [open, align, children])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onScroll() {
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return (
    <div ref={rootRef} className="inline-flex relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {button}
      </button>
      {open && pos && (
        <div
          role="menu"
          className="fixed z-50 bg-white border border-border rounded-lg shadow-lg p-1 min-w-[120px]"
          style={{ top: pos.top, left: pos.left }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function Button({
  className,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-primary text-white hover:opacity-95',
    secondary: 'bg-[#f3f4f6] text-foreground border border-border hover:bg-[#ebecef]',
    ghost: 'bg-transparent text-foreground hover:bg-canvas',
    danger: 'bg-danger text-white',
  }[variant]
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[8px] px-4 h-10 text-sm font-medium whitespace-nowrap transition disabled:opacity-50',
        styles,
        className,
      )}
      {...props}
    />
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full h-10 rounded-[8px] border border-border bg-[#f7f8f8] px-3 text-base sm:text-sm outline-none focus:ring-2 focus:ring-primary/30',
        className,
      )}
      {...props}
    />
  )
}

export function Label({ children, className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('block text-sm font-semibold mb-1.5', className)} {...props}>{children}</label>
}

export function Card({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-border bg-white shadow-sm', className)} {...props}>
      {children}
    </div>
  )
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium bg-[#f3f4f6] text-foreground', className)}>
      {children}
    </span>
  )
}

export function Delta({ value }: { value: number }) {
  const up = value >= 0
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-semibold tabular-nums', up ? 'text-emerald-600' : 'text-red-500')}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {up ? '+' : ''}{value.toFixed(1)}%
    </span>
  )
}

export function StatCard({
  to,
  Icon,
  title,
  note,
  value,
  delta,
  foot,
  className,
}: {
  to?: string
  Icon?: LucideIcon
  title: string
  note?: string
  value: ReactNode
  delta?: number | null
  foot?: ReactNode
  className?: string
}) {
  const body = (
    <Card className={cn('p-5 h-full group-hover:shadow-md group-hover:border-[#f2ccc1]', className)}>
      <div className="flex items-center gap-2.5">
        {Icon ? (
          <span className="h-8 w-8 rounded-lg bg-nav-wash text-[#991B1B] flex items-center justify-center">
            <Icon size={16} />
          </span>
        ) : null}
        <span className="text-sm font-medium text-muted">{title}</span>
      </div>
      {note ? <div className="text-xs text-muted mt-4">{note}</div> : null}
      <div className="text-[26px] font-semibold tracking-tight tabular-nums mt-1">{value}</div>
      <div className="text-xs mt-3 flex items-center gap-1.5 text-muted">
        {typeof delta === 'number' ? (
          <>
            <Delta value={delta} /> <span>vs last month</span>
          </>
        ) : (
          foot
        )}
      </div>
    </Card>
  )
  if (to) {
    return (
      <Link to={to} className="group block h-full">
        {body}
      </Link>
    )
  }
  return body
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-16 w-16 rounded-2xl bg-[#f3f4f6] mb-4 flex items-center justify-center text-muted">
        <Inbox size={28} />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {body ? <p className="text-muted mt-1 max-w-md text-sm text-pretty">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}