/* -----------------------------------------------------------------------------
 * Seller notifications center — full list with mark-one / mark-all read and
 * realtime refresh via the notifications table.
 * -------------------------------------------------------------------------- */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Ban,
  Banknote,
  Bell,
  CircleX,
  LifeBuoy,
  PackageCheck,
  RefreshCw,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { useTableChanges } from "../../workspace-realtime.ts";
import { formatDateTime } from "../workspace/format.ts";
import {
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type OrderNotification,
} from "../notifications/notifications-api.ts";
import { SupplierWorkspaceShell, type SupplierNotice } from "./supplier-shared.tsx";

const NOTIFICATION_TABLES = ["notifications"] as const;
const CENTER_LIMIT = 50;

type SupplierNotificationsProps = {
  loadItems?: (limit?: number) => Promise<OrderNotification[]>;
};

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
    case "delivery_verified":
      return PackageCheck;
    case "supplier_verified":
      return BadgeCheck;
    case "product_hidden":
    case "product_removed":
      return Ban;
    case "product_restored":
      return PackageCheck;
    case "order_support_requested":
      return LifeBuoy;
    default:
      return Bell;
  }
}

export function SupplierNotifications({
  loadItems = loadNotifications,
}: SupplierNotificationsProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/notifications" });
  const [notifications, setNotifications] = useState<OrderNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<SupplierNotice | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const retry = useCallback(() => setLoadVersion((version) => version + 1), []);

  useTableChanges({
    enabled: Boolean(notifications) && !error,
    tables: NOTIFICATION_TABLES,
    onChange: retry,
    coalesceMs: 800,
  });

  useEffect(() => {
    let current = true;
    setError(null);
    setLoading(true);

    void loadItems(CENTER_LIMIT)
      .then((items) => {
        if (!current) return;
        setNotifications(items);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [loadItems, loadVersion]);

  const unreadCount = useMemo(
    () => (notifications ?? []).filter((item) => !item.read_at).length,
    [notifications],
  );

  if (state.status !== "seller") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const userName = state.profile.name || state.profile.email;

  if (error && !notifications) {
    return (
      <WorkspaceError
        eyebrow="Seller workspace"
        title="We could not load your notifications."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const markRead = (notification: OrderNotification) => {
    if (notification.read_at) return;
    void markNotificationRead(notification.id)
      .then((readAt) => {
        setNotifications((items) =>
          (items ?? []).map((item) =>
            item.id === notification.id ? { ...item, read_at: readAt } : item,
          ),
        );
      })
      .catch((markError: unknown) => {
        setNotice({
          message: markError instanceof Error ? markError.message : "Please try again.",
          state: "error",
        });
      });
  };

  const markAllRead = () => {
    if (!unreadCount || markingAll) return;
    setMarkingAll(true);
    setNotice(null);
    void markAllNotificationsRead()
      .then((count) => {
        const readAt = new Date().toISOString();
        setNotifications((items) =>
          (items ?? []).map((item) => (item.read_at ? item : { ...item, read_at: readAt })),
        );
        setNotice({
          message:
            count > 0
              ? `Marked ${count} notification${count === 1 ? "" : "s"} as read.`
              : "All caught up.",
          state: "success",
        });
      })
      .catch((markError: unknown) => {
        setNotice({
          message: markError instanceof Error ? markError.message : "Please try again.",
          state: "error",
        });
      })
      .finally(() => setMarkingAll(false));
  };

  return (
    <SupplierWorkspaceShell
      section="notifications"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Inbox"
        title="Notifications."
        copy="Order, stock, and payout alerts for your seller workspace."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!unreadCount || markingAll}
              onClick={markAllRead}
            >
              {markingAll ? <Spinner data-icon="inline-start" /> : null}
              Mark all read
            </Button>
            <Button type="button" variant="ghost" disabled={loading} onClick={retry}>
              {loading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              Refresh
            </Button>
          </div>
        }
      />

      <InlineNotice message={notice?.message} state={notice?.state} />

      {notifications ? (
        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <CardTitle>Recent alerts</CardTitle>
              <CardDescription>
                Showing up to {CENTER_LIMIT} newest notifications
                {unreadCount > 0 ? ` · ${unreadCount} unread` : ""}.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {notifications.length ? (
              <ul className="flex flex-col gap-3" aria-label="Notifications">
                {notifications.map((notification) => {
                  const Icon = notificationIcon(notification.type);
                  const unread = !notification.read_at;
                  return (
                    <li
                      key={notification.id}
                      className="flex items-start gap-3 rounded-lg border p-3"
                    >
                      <span className="mt-0.5 text-muted-foreground">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{notification.title}</p>
                          {unread ? <Badge variant="outline">New</Badge> : null}
                        </div>
                        <p className="text-sm text-muted-foreground whitespace-normal">
                          {notification.message}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(notification.created_at)}
                        </p>
                      </div>
                      {unread ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => markRead(notification)}
                        >
                          Mark read
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={Bell}
                title="No notifications yet"
                copy="Order, stock, and payout alerts will show up here as your shop gets activity."
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <LoadingState title="Loading notifications…" />
      )}
    </SupplierWorkspaceShell>
  );
}
