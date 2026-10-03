// In-app notifications: initial load + Supabase Realtime, unread count, mark as read.
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AppNotification {
  id: string;
  type: "connection_request" | "connection_accepted" | "connection_declined" | "security" | "event" | "system";
  title: string;
  body: string | null;
  data: { request_id?: string; from_user?: string; event_id?: string; screen?: string };
  read_at: string | null;
  created_at: string;
}

export function haptic(pattern: number | number[] = 25) {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* unsupported */
  }
}

export function useNotifications(supabase: SupabaseClient, userId: string | null, onArrive?: (n: AppNotification) => void) {
  const [items, setItems] = useState<AppNotification[]>([]);

  const load = useCallback(async () => {
    if (!userId) return setItems([]);
    const { data } = await supabase.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
    setItems((data || []) as AppNotification[]);
  }, [supabase, userId]);

  useEffect(() => {
    load();
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload: any) => {
        if (payload.eventType === "INSERT") {
          const n = payload.new as AppNotification;
          setItems((cur) => (cur.some((x) => x.id === n.id) ? cur : [n, ...cur]));
          onArrive?.(n);
        } else if (payload.eventType === "UPDATE") {
          setItems((cur) => cur.map((x) => (x.id === payload.new.id ? (payload.new as AppNotification) : x)));
        } else if (payload.eventType === "DELETE") {
          setItems((cur) => cur.filter((x) => x.id !== payload.old.id));
        }
      })
      .subscribe();
    // Realtime can drop on flaky mobile networks — poll as a safety net
    const timer = setInterval(load, 60_000);
    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, userId, load]);

  const markRead = useCallback(
    async (ids?: string[]) => {
      setItems((cur) => cur.map((x) => (!ids || ids.includes(x.id) ? { ...x, read_at: x.read_at || new Date().toISOString() } : x)));
      await supabase.rpc("mark_notifications_read", { p_ids: ids ?? null });
    },
    [supabase]
  );

  return { items, unread: items.filter((n) => !n.read_at).length, markRead, reload: load };
}
