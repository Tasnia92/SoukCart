import type { AuthUser } from '@/context/auth'

export function homeForRole(user: AuthUser) {
  if (user.role === 'admin') return '/admin'
  if (user.role === 'supplier') return user.verificationStatus === 'approved' ? '/supplier' : '/supplier/verification'
  return '/retailer/products'
}
