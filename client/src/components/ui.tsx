import { ArrowDownRight, ArrowUpRight, Inbox, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react'

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