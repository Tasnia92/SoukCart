import { useEffect, useState } from "react";
import { formatDateTime } from "../workspace/format.ts";
import {
  loadNotifications,
  markNotificationRead,
  type OrderNotification,
} from "./notifications-api.ts";

export function NotificationsPanel() {
  const [notifications, setNotifications] = useState<OrderNotification[]>([]);

  useEffect(() => {
    let current = true;
    void loadNotifications()
      .then((items) => {
        if (current) setNotifications(items);
      })
      .catch(() => {
        // Notifications are supplemental and must not block the order workspace.
      });
    return () => {
      current = false;
    };
  }, []);

  const markRead = (notification: OrderNotification) => {
    if (notification.read_at) return;
    void markNotificationRead(notification.id).then((readAt) => {
      setNotifications((items) =>
        items.map((item) => (item.id === notification.id ? { ...item, read_at: readAt } : item)),
      );
    });
  };

  if (!notifications.length) return null;

  return (
    <section className="cp-list" aria-label="Order notifications">
      <div className="rt-section-heading">
        <div>
          <p className="eyebrow">Updates</p>
          <h2 className="display-sm">Notifications</h2>
        </div>
        <span className="admin-result-count">
          {notifications.filter((notification) => !notification.read_at).length} unread
        </span>
      </div>
      <div className="cp-list-cards">
        {notifications.map((notification) => (
          <article className="cp-card" key={notification.id}>
            <div className="cp-card-top">
              <strong>{notification.title}</strong>
              {!notification.read_at ? <span className="rt-cancel-flag">New</span> : null}
            </div>
            <p>{notification.message}</p>
            <small>{formatDateTime(notification.created_at)}</small>
            {!notification.read_at ? (
              <button className="text-button" type="button" onClick={() => markRead(notification)}>
                Mark as read
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
