import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import { usePoll } from '@/lib/poll'

type NotificationState = {
  unread: number
  refresh: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

const NotificationContext = createContext<NotificationState | null>(null)

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [unread, setUnread] = useState(0)

  const refresh = useCallback(async () => {
    if (!token) {
      setUnread(0)
      return
    }
    try {
      const d = await api.get<{ count: number }>('/notifications/unread-count')
      setUnread(Number(d.count) || 0)
    } catch {
      /* ignore while logged out / flaky */
    }
  }, [token])

  usePoll(() => void refresh(), [token, refresh])

  const value = useMemo<NotificationState>(() => ({
    unread,
    refresh,
    async markRead(id: string) {
      await api.patch(`/notifications/${id}/read`)
      await refresh()
    },
    async markAllRead() {
      await api.post('/notifications/read-all')
      await refresh()
    },
  }), [unread, refresh])

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications outside provider')
  return ctx
}
