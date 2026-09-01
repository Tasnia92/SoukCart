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

export async function loadNotifications(): Promise<OrderNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, order_id, type, title, message, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(10);
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
