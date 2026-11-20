import { createContext, useContext } from 'react'

export type Role = 'retailer' | 'supplier' | 'admin'

export type AuthUser = {
  id: string
  _id?: string
  name: string
  email: string
  role: Role
  phone?: string
  verificationStatus?: string
  verificationRejectReason?: string
  businessName?: string
  shopSlug?: string
  shopLink?: string
  businessDescription?: string
  updatedAt?: string
}

export type AuthState = {
  user: AuthUser | null
  token: string | null
  loading: boolean
  login: (email: string, password: string, persist?: boolean) => Promise<AuthUser>
  register: (payload: Record<string, string>) => Promise<AuthUser>
  logout: () => void
  refresh: () => Promise<AuthUser | null>
  updateProfile: (payload: Record<string, string>) => Promise<AuthUser>
  changeEmail: (email: string, password: string) => Promise<AuthUser>
  changePassword: (currentPassword: string, password: string) => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
