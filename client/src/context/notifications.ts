import { createContext, useContext } from 'react'

export type NotificationState = {
  unread: number
  refresh: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

export const NotificationContext = createContext<NotificationState | null>(null)

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications outside provider')
  return ctx
}
