import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Package } from 'lucide-react'
import { Badge, Button, Card, EmptyState } from '@/components/ui'
import { api } from '@/services/api'
import { useNotifications } from '@/context/NotificationContext'

export function NotificationsInbox({ heading = 'Notifications' }: { heading?: string }) {
  const [items, setItems] = useState<any[]>([])
  const { refresh, markRead, markAllRead } = useNotifications()

  async function load() {
    const d = await api.get<{ notifications: any[] }>('/notifications')
    setItems(d.notifications || [])
    await refresh()
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">Inbox</p>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-2xl font-semibold">{heading}</h2>
        <Button
          variant="secondary"
          disabled={!items.some((n) => !n.isRead)}
          onClick={() => void markAllRead().then(load)}
        >
          Mark all read
        </Button>
      </div>
      <Card className="p-2">
        <div className="px-3 py-2 text-sm font-medium border-b border-border">Recent alerts</div>
        {items.map((n) => (
          <div
            key={n._id}
            className={`px-3 py-3 border-b border-border last:border-0 flex gap-3 items-start ${n.isRead ? '' : 'bg-[#fff8f5]'}`}
          >
            <div className="h-10 w-10 rounded-full bg-[#f3f4f6] flex items-center justify-center shrink-0">
              <Package size={16} className="text-muted" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">
                {n.title}
                {!n.isRead && <Badge className="ml-2">New</Badge>}
              </div>
              <p className="text-sm text-muted mt-0.5">{n.body}</p>
              <div className="text-xs text-muted mt-1">{new Date(n.createdAt).toLocaleString()}</div>
            </div>
            <div className="flex flex-col gap-2 items-end shrink-0">
              {n.link ? (
                <Link
                  to={n.link}
                  className="text-sm text-primary font-medium"
                  onClick={() => {
                    if (!n.isRead) void markRead(n._id).then(load)
                  }}
                >
                  View →
                </Link>
              ) : null}
              {!n.isRead && (
                <Button variant="secondary" className="h-8 text-xs" onClick={() => void markRead(n._id).then(load)}>
                  Mark read
                </Button>
              )}
            </div>
          </div>
        ))}
        {!items.length && <div className="p-4"><EmptyState title="No notifications" body="Alerts for orders, delivery, and refunds will show up here." /></div>}
      </Card>
    </div>
  )
}
