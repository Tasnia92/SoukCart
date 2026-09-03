import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatDateTime } from "../workspace/format.ts";
import {
  loadNotifications,
  markNotificationRead,
  type OrderNotification,
} from "./notifications-api.ts";

export function NotificationsBell() {
  const [notifications, setNotifications] = useState<OrderNotification[]>([]);

  useEffect(() => {
    let current = true;
    void loadNotifications()
      .then((items) => {
        if (current) setNotifications(items);
      })
      .catch(() => {
        // Notifications are supplemental and must not block the workspace.
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

  const unread = notifications.filter((notification) => !notification.read_at).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell />
          {unread > 0 ? (
            <Badge
              variant="default"
              className="absolute top-1 right-1 min-w-4 px-1 py-0 text-[10px] leading-4"
            >
              {unread}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <PopoverHeader className="p-3">
          <PopoverTitle>Notifications</PopoverTitle>
          <PopoverDescription>
            {unread === 0 ? "You're up to date" : `${unread} unread`}
          </PopoverDescription>
        </PopoverHeader>
        <Separator />
        {notifications.length ? (
          <ScrollArea className="h-80">
            <ItemGroup>
              {notifications.map((notification) => (
                <Item
                  key={notification.id}
                  size="sm"
                  variant={notification.read_at ? "default" : "muted"}
                >
                  <ItemContent>
                    <ItemTitle>
                      {notification.title}
                      {!notification.read_at ? <Badge variant="outline">New</Badge> : null}
                    </ItemTitle>
                    <ItemDescription>{notification.message}</ItemDescription>
                    <ItemDescription>{formatDateTime(notification.created_at)}</ItemDescription>
                  </ItemContent>
                  {!notification.read_at ? (
                    <ItemActions>
                      <Button
                        variant="ghost"
                        size="xs"
                        type="button"
                        onClick={() => markRead(notification)}
                      >
                        Mark as read
                      </Button>
                    </ItemActions>
                  ) : null}
                </Item>
              ))}
            </ItemGroup>
          </ScrollArea>
        ) : (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Bell />
              </EmptyMedia>
              <EmptyTitle>No notifications</EmptyTitle>
              <EmptyDescription>Order updates will show up here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** @deprecated Use NotificationsBell in the workspace header. Kept for existing imports. */
export function NotificationsPanel() {
  return <NotificationsBell />;
}
