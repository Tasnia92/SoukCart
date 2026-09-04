import { supabase } from "../../supabase.ts";

export type OrderNotification = {
  id: string;
  order_id: string | null;
  type: string;
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
};

type NotificationRow = OrderNotification;

const DEFAULT_NOTIFICATION_LIMIT = 50;

export async function loadNotifications(
  limit: number = DEFAULT_NOTIFICATION_LIMIT,
): Promise<OrderNotification[]> {
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : DEFAULT_NOTIFICATION_LIMIT;
  const { data, error } = await supabase
    .from("notifications")
    .select("id, order_id, type, title, message, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error(error.message);
  return (data ?? []) as NotificationRow[];
}

export async function markNotificationRead(notificationId: string): Promise<string> {
  const readAt = new Date().toISOString();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: readAt })
    .eq("id", notificationId);
  if (error) throw new Error(error.message);
  return readAt;
}

export async function markAllNotificationsRead(): Promise<number> {
  const { data, error } = await supabase.rpc("mark_all_notifications_read");
  if (error) throw new Error(error.message);
  const count = Number(data);
  return Number.isFinite(count) ? Math.trunc(count) : 0;
}
