import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, clearToken, getToken, setToken as persistToken } from '@/services/api'
import { AuthContext, type AuthState, type AuthUser } from '@/context/auth'

function asUser(u: AuthUser): AuthUser {
  return { ...u, id: u.id || String(u._id) }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(getToken())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      if (!token) {
        setLoading(false)
        return
      }
      try {
        const data = await api.get<{ user: AuthUser }>('/auth/me')
        setUser(asUser(data.user))
      } catch {
        clearToken()
        setToken(null)
        setUser(null)
      } finally {
        setLoading(false)
      }
    })()
  }, [token])

  const value = useMemo<AuthState>(() => ({
    user,
    token,
    loading,
    async login(email, password, persist = true) {
      const data = await api.post<{ token: string; user: AuthUser }>('/auth/login', { email, password })
      persistToken(data.token, persist)
      setToken(data.token)
      setUser(asUser(data.user))
      return data.user
    },
    async register(payload) {
      const data = await api.post<{ token: string; user: AuthUser }>('/auth/register', payload)
      persistToken(data.token, true)
      setToken(data.token)
      setUser(asUser(data.user))
      return data.user
    },
    logout() {
      clearToken()
      setToken(null)
      setUser(null)
    },
    async refresh() {
      const t = getToken()
      if (!t) {
        setUser(null)
        return null
      }
      const data = await api.get<{ user: AuthUser }>('/auth/me')
      const next = asUser(data.user)
      setUser(next)
      return next
    },
    async updateProfile(payload) {
      const data = await api.patch<{ user: AuthUser }>('/auth/me', payload)
      const next = asUser(data.user)
      setUser(next)
      return next
    },
    async changeEmail(email, password) {
      const data = await api.patch<{ user: AuthUser }>('/auth/email', { email, password })
      const next = asUser(data.user)
      setUser(next)
      return next
    },
    async changePassword(currentPassword, password) {
      await api.patch('/auth/password', { currentPassword, password })
    },
  }), [user, token, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
