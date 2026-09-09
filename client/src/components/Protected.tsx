import { Navigate } from 'react-router-dom'
import { useAuth, type Role, type AuthUser } from '@/context/AuthContext'
import type { ReactNode } from 'react'

export function Protected({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-10 text-muted">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/login" replace />
  return children
}

export function homeForRole(user: AuthUser) {
  if (user.role === 'admin') return '/admin'
  if (user.role === 'supplier') return user.verificationStatus === 'approved' ? '/supplier' : '/supplier/verification'
  return '/retailer/products'
}

/**
 * Gives suppliers full access only after their application is approved.
 * Until then they are held on the verification page.
 */
export function VerifiedSupplier({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-10 text-muted">Loading…</div>
  if (user?.role === 'supplier' && user.verificationStatus !== 'approved') {
    return <Navigate to="/supplier/verification" replace />
  }
  return children
}

/** Blocks already-authenticated users from visiting public pages (login / register). */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-10 text-muted">Loading…</div>
  if (user) return <Navigate to={homeForRole(user)} replace />
  return children
}
