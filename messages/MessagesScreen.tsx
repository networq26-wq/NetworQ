// Messages: every 1:1 conversation in one place, newest first, with unread counts. Live via realtime.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createChatApi } from "../chat/chatApi";
import { I, Skeleton } from "../ui/icons";

type Conversation = { chat_id: string; other_user: string; name: string; avatar: string | null; last_message_at: string; last_message: string | null; unread: number };

function when(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function MessagesScreen({
  supabase,
  userId,
  isDark,
  onOpenChat,
  onOpenRadar,
}: {
  supabase: SupabaseClient;
  userId: string;
  isDark: boolean;
  onOpenChat: (p: { id: string; name: string; avatar_url?: string | null }) => void;
  onOpenRadar: () => void;
}) {
  const api = useMemo(() => createChatApi(supabase), [supabase]);
  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [error, setError] = useState(false);
  const t = isDark
    ? { surface: "#1C1C1E", raised: "#2C2C2E", text: "#FFFFFF", muted: "#AEAEB2", border: "rgba(255,255,255,0.08)" }
    : { surface: "#FFFFFF", raised: "#F2F2F7", text: "#1C1C1E", muted: "#6E6E73", border: "rgba(0,0,0,0.06)" };

  const load = useCallback(async () => {
    try {
      setRows(await api.myChats());
      setError(false);
    } catch {
      setError(true);
      setRows((r) => r ?? []);
    }
  }, [api]);

  useEffect(() => {
    load();
    // New messages to me refresh the list instantly; a slow poll covers missed events
    const ch = supabase
      .channel(`inbox:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `recipient_id=eq.${userId}` }, () => load())
      .subscribe();
    const timer = setInterval(load, 30_000);
    return () => {
      clearInterval(timer);
      supabase.removeChannel(ch);
    };
  }, [supabase, userId, load]);

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <h2 style={{ margin: "4px 0 16px", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>Messages</h2>

      {rows === null ? (
        <div role="status" aria-label="Loading messages" style={{ background: t.surface, borderRadius: 20, border: `1px solid ${t.border}`, padding: "4px 16px" }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 0", borderTop: i ? `1px solid ${t.border}` : "none" }}>
              <Skeleton w={48} h={48} r={24} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <Skeleton w="45%" h={14} />
                <Skeleton w="75%" h={12} />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="nq-pop" style={{ background: t.surface, borderRadius: 24, border: `1px solid ${t.border}`, padding: "40px 24px", textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 32, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", background: isDark ? "rgba(167,139,250,0.14)" : "rgba(124,58,237,0.08)", color: "#7C3AED" }}>
            <I.Mail size={28} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{error ? "Couldn't load messages" : "No messages yet"}</div>
          <div style={{ color: t.muted, fontSize: 15, lineHeight: 1.5, maxWidth: 320, margin: "8px auto 20px" }}>
            {error ? "Check your connection and try again." : "Connect with someone on Radar, then you can message each other here."}
          </div>
          <button onClick={error ? load : onOpenRadar} style={{ minHeight: 50, padding: "0 28px", borderRadius: 14, border: "none", background: "#7C3AED", color: "#FFF", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
            {error ? "Try again" : "Open Radar"}
          </button>
        </div>
      ) : (
        <ul aria-label="Conversations" className="nq-stagger" style={{ listStyle: "none", margin: 0, padding: "4px 0", background: t.surface, borderRadius: 20, border: `1px solid ${t.border}`, overflow: "hidden" }}>
          {rows.map((c, i) => (
            <li key={c.chat_id} style={{ borderTop: i ? `1px solid ${t.border}` : "none" }}>
              <button
                onClick={() => onOpenChat({ id: c.other_user, name: c.name, avatar_url: c.avatar })}
                aria-label={`${c.name}${c.unread ? `, ${c.unread} unread` : ""}`}
                style={{ all: "unset", boxSizing: "border-box", width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", cursor: "pointer", minHeight: 72 }}
              >
                {c.avatar ? (
                  <img src={c.avatar} alt="" width={48} height={48} style={{ borderRadius: 24, objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <span aria-hidden style={{ width: 48, height: 48, borderRadius: 24, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: isDark ? "rgba(167,139,250,0.16)" : "#EDE9FE", color: "#7C3AED", fontWeight: 700, fontSize: 18 }}>
                    {(c.name || "?").trim().charAt(0).toUpperCase()}
                  </span>
                )}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: c.unread ? 700 : 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    <span style={{ fontSize: 13, color: c.unread ? "#7C3AED" : t.muted, flexShrink: 0 }}>{when(c.last_message_at)}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: c.unread ? t.text : t.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.last_message || "Say hello"}</span>
                    {c.unread > 0 && (
                      <span style={{ minWidth: 22, height: 22, padding: "0 7px", borderRadius: 11, background: "#7C3AED", color: "#FFF", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>{c.unread}</span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
