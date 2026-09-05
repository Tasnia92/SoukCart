import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BadgeCheck,
  Ban,
  Banknote,
  Bell,
  CircleCheckBig,
  CircleX,
  LifeBuoy,
  PackageCheck,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import { useSessionSnapshot } from "../../session.tsx";
import { useTableChanges } from "../../workspace-realtime.ts";
import { formatDateTime } from "../workspace/format.ts";
import {
  loadNotifications,
  markNotificationRead,
  type OrderNotification,
} from "./notifications-api.ts";

const BELL_NOTIFICATION_LIMIT = 10;

function notificationIcon(type: string): LucideIcon {
  switch (type) {
    case "order_cancellation_requested":
    case "supplier_cancellation_requested":
      return Ban;
    case "order_cancellation_rejected":
    case "order_cancelled":
      return CircleX;
    case "manual_refund_completed":
    case "payout_paid":
      return Banknote;
    case "cod_collected":
      return Wallet;
    case "order_confirmed":
    case "order_needs_confirmation":
      return CircleCheckBig;
    case "delivery_initiated":
    case "order_dispatched":
    case "order_out_for_delivery":
    case "order_shipped":
      return Truck;
    case "order_delivered":
    case "delivery_verified":
      return PackageCheck;
    case "supplier_verified":
      return BadgeCheck;
    case "order_support_requested":
      return LifeBuoy;
    default:
      return Bell;
  }
}

function notificationHref(
  notification: OrderNotification,
  role: "retailer" | "seller" | "admin" | null,
): { to: string; search?: Record<string, string> } | null {
  if (notification.order_id) {
    if (role === "seller") {
      return { to: "/supplier/orders", search: { order: notification.order_id } };
    }
    if (role === "retailer") {
      return { to: "/retailer/orders", search: { order: notification.order_id } };
    }
    if (role === "admin") {
      return { to: "/admin/activity", search: { order: notification.order_id } };
    }
  }

  if (notification.type === "supplier_verified" && role === "seller") {
    return { to: "/supplier/settings" };
  }

  if (notification.type === "payout_paid" && role === "seller") {
    return { to: "/supplier/earnings" };
  }

  return null;
}

export function NotificationsBell({
  viewAllTo,
}: {
  viewAllTo?: "/supplier/notifications" | "/retailer/notifications";
} = {}) {
  const navigate = useNavigate();
  const { state } = useSessionSnapshot();
  const [notifications, setNotifications] = useState<OrderNotification[]>([]);
  const [loadVersion, setLoadVersion] = useState(0);
  const reload = useCallback(() => setLoadVersion((version) => version + 1), []);

  const role =
    state.status === "retailer" || state.status === "seller" || state.status === "admin"
      ? state.status
      : null;

  useEffect(() => {
    let current = true;
    void loadNotifications(BELL_NOTIFICATION_LIMIT)
      .then((items) => {
        if (current) setNotifications(items);
      })
      .catch(() => {
        // Notifications are supplemental and must not block the workspace.
      });
    return () => {
      current = false;
    };
  }, [loadVersion]);

  useTableChanges({
    enabled: true,
    tables: ["notifications"],
    onChange: reload,
    coalesceMs: 800,
  });

  const markRead = (notification: OrderNotification) => {
    if (notification.read_at) return;
    void markNotificationRead(notification.id).then((readAt) => {
      setNotifications((items) =>
        items.map((item) => (item.id === notification.id ? { ...item, read_at: readAt } : item)),
      );
    });
  };

  const openNotification = (notification: OrderNotification) => {
    markRead(notification);
    const href = notificationHref(notification, role);
    if (!href) return;
    void navigate({ to: href.to as never, search: (href.search ?? {}) as never });
  };

  const unread = notifications.filter((notification) => !notification.read_at).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {unread > 0 ? `Notifications · ${unread} unread` : "Notifications"}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {notifications.length > 0 ? (
          <DropdownMenuGroup>
            {notifications.map((notification) => {
              const Icon = notificationIcon(notification.type);
              return (
                <DropdownMenuItem
                  key={notification.id}
                  className="items-start"
                  onSelect={() => openNotification(notification)}
                >
                  <Icon />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{notification.title}</span>
                      {notification.read_at ? null : <Badge variant="outline">New</Badge>}
                    </span>
                    <span className="text-muted-foreground whitespace-normal">
                      {notification.message}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDateTime(notification.created_at)}
                    </span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ) : (
          <DropdownMenuGroup>
            <DropdownMenuItem disabled>
              <Bell />
              No notifications
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
        {viewAllTo ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <RouterLink to={viewAllTo}>View all notifications</RouterLink>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** @deprecated Use NotificationsBell in the workspace header. Kept for existing imports. */
export function NotificationsPanel() {
  return <NotificationsBell />;
}
