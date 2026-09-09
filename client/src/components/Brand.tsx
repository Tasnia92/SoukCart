import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

export function Brand({
  className = '',
  to = '/',
  dark = true,
  markOnly = false,
  markHeight = 30,
}: {
  className?: string
  to?: string
  dark?: boolean
  markOnly?: boolean
  /** Mark height in px; header 28–32, footer ~24 */
  markHeight?: number
}) {
  return (
    <Link to={to} className={cn('inline-flex items-center gap-2.5', className)}>
      <img
        src="/brand/logo-mark.png"
        alt=""
        width={Math.round(markHeight * 1.17)}
        height={markHeight}
        className="object-contain"
        style={{ height: markHeight, width: 'auto' }}
        aria-hidden={!markOnly}
      />
      {!markOnly && (
        <span className={cn('font-bold tracking-tight lowercase text-lg', dark ? 'text-foreground' : 'text-white')}>
          soukcart
        </span>
      )}
      {markOnly && <span className="sr-only">soukcart</span>}
    </Link>
  )
}

export function FloatingN() {
  return null
}
