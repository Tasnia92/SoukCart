import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/services/api'
import { useAuth } from '@/context/auth'
import { NotificationContext, type NotificationState } from '@/context/notifications'
import { usePoll } from '@/lib/poll'

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
