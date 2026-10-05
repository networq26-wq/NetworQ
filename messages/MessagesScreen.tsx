// Messages: every 1:1 conversation in one place, newest first, with unread counts. Live via realtime.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createChatApi } from "../chat/chatApi";
import { I, Skeleton } from "../ui/icons";
import { placeCall } from "../calls/CallLayer";

type Contact = { id: string; name?: string; title?: string; company?: string; email?: string; phone?: string; image?: string; linkedUserId?: string | null };

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
  contacts = [],
  inviterName = "",
}: {
  supabase: SupabaseClient;
  userId: string;
  isDark: boolean;
  onOpenChat: (p: { id: string; name: string; avatar_url?: string | null }) => void;
  onOpenRadar: () => void;
  contacts?: Contact[];
  inviterName?: string;
}) {
  const [picking, setPicking] = useState(false);
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "4px 0 16px" }}>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>Messages</h2>
        <button
          onClick={() => setPicking(true)}
          className="btn-press"
          style={{ minHeight: 40, padding: "0 16px", borderRadius: 20, border: "none", background: "#7C3AED", color: "#FFFFFF", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <I.UserPlus size={17} /> New message
        </button>
      </div>
      {picking && (
        <ContactPicker
          contacts={contacts}
          isDark={isDark}
          inviterName={inviterName}
          onClose={() => setPicking(false)}
          onChat={(c) => {
            setPicking(false);
            onOpenChat({ id: c.linkedUserId!, name: c.name || "NetworQ member", avatar_url: c.image || null });
          }}
        />
      )}

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
            {error ? "Check your connection and try again." : "Tap New message to write to one of your contacts, or meet new people on Radar."}
          </div>
          <button onClick={error ? load : () => setPicking(true)} style={{ minHeight: 50, padding: "0 28px", borderRadius: 14, border: "none", background: "#7C3AED", color: "#FFF", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
            {error ? "Try again" : "New message"}
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

// Pick who to write to. People on NetworQ can be messaged or called right away; everyone else gets an invite.
function ContactPicker({ contacts, isDark, inviterName, onClose, onChat }: { contacts: Contact[]; isDark: boolean; inviterName: string; onClose: () => void; onChat: (c: Contact) => void }) {
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const t = isDark
    ? { sheet: "#1C1C1E", raised: "#2C2C2E", text: "#FFFFFF", muted: "#AEAEB2", line: "rgba(255,255,255,0.08)" }
    : { sheet: "#FFFFFF", raised: "#F2F2F7", text: "#1C1C1E", muted: "#6E6E73", line: "rgba(0,0,0,0.06)" };
  const needle = q.trim().toLowerCase();
  const match = (c: Contact) => !needle || [c.name, c.company, c.title, c.email].some((v) => (v || "").toLowerCase().includes(needle));
  const byName = (a: Contact, b: Contact) => (a.name || "").localeCompare(b.name || "");
  const onApp = contacts.filter((c) => c.linkedUserId && match(c)).sort(byName);
  const others = contacts.filter((c) => !c.linkedUserId && match(c)).sort(byName);

  const invite = async (c: Contact) => {
    const first = (c.name || "").split(" ")[0] || "there";
    const text = `Hi ${first}, it's ${inviterName || "me"} — let's stay connected on NetworQ so we can message and call each other: https://www.networq.co.in`;
    try {
      if ((navigator as any).share) return void (await navigator.share({ text }));
    } catch (e: any) {
      if (e?.name === "AbortError") return;
    }
    if (c.phone) {
      let digits = c.phone.replace(/[^\d]/g, "").replace(/^0+/, "");
      if (digits.length === 10) digits = `91${digits}`; // a local Indian number
      window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, "_blank");
    } else if (c.email) window.location.href = `mailto:${c.email}?subject=${encodeURIComponent("Let's connect on NetworQ")}&body=${encodeURIComponent(text)}`;
    else {
      await navigator.clipboard?.writeText(text).catch(() => {});
      setCopied(c.id);
      setTimeout(() => setCopied(null), 2500);
    }
  };

  const avatar = (c: Contact) =>
    c.image ? (
      <img src={c.image} alt="" width={44} height={44} style={{ borderRadius: 22, objectFit: "cover", flexShrink: 0 }} />
    ) : (
      <span aria-hidden style={{ width: 44, height: 44, borderRadius: 22, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: isDark ? "rgba(167,139,250,0.16)" : "#EDE9FE", color: "#7C3AED", fontWeight: 700, fontSize: 17 }}>
        {(c.name || "?").trim().charAt(0).toUpperCase()}
      </span>
    );
  const sub = (c: Contact) => [c.title, c.company].filter(Boolean).join(" · ");
  const iconBtn: React.CSSProperties = { width: 40, height: 40, borderRadius: 20, border: "none", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: isDark ? "rgba(167,139,250,0.14)" : "rgba(124,58,237,0.08)", color: isDark ? "#C4B5FD" : "#7C3AED" };
  const section = (title: string, hint: string) => (
    <div style={{ margin: "18px 4px 8px" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: t.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>{title}</div>
      <div style={{ fontSize: 13, color: t.muted, marginTop: 2 }}>{hint}</div>
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="New message" style={{ position: "fixed", inset: 0, zIndex: 400, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div className="nq-backdrop" onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} />
      <div className="nq-sheet-up" style={{ position: "relative", width: "100%", maxWidth: 560, height: "min(86dvh, 760px)", background: t.sheet, color: t.text, borderRadius: "28px 28px 0 0", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
        <div style={{ padding: "10px 20px 0" }}>
          <div aria-hidden style={{ width: 36, height: 5, borderRadius: 3, background: t.line, margin: "0 auto 12px" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>New message</h3>
            <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 16, border: "none", background: t.raised, color: t.muted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <I.X size={16} />
            </button>
          </div>
          <div style={{ position: "relative", marginTop: 14 }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: t.muted, display: "flex" }}>
              <I.Search size={17} />
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your contacts"
              aria-label="Search your contacts"
              autoFocus
              style={{ width: "100%", boxSizing: "border-box", minHeight: 46, borderRadius: 14, border: "none", background: t.raised, color: t.text, padding: "0 14px 0 40px", fontSize: 16, fontFamily: "inherit", outline: "none" }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px calc(20px + var(--safe-bottom, env(safe-area-inset-bottom, 0px)))" }}>
          {onApp.length > 0 && section("On NetworQ", "Message or call them right here")}
          {onApp.length > 0 && (
            <ul aria-label="Contacts on NetworQ" style={{ listStyle: "none", margin: 0, padding: 0, background: isDark ? "#2C2C2E" : "#F9F9FB", borderRadius: 18, overflow: "hidden" }}>
              {onApp.map((c, i) => (
                <li key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 14px", borderTop: i ? `1px solid ${t.line}` : "none" }}>
                  <button onClick={() => onChat(c)} aria-label={`Message ${c.name}`} style={{ all: "unset", boxSizing: "border-box", flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                    {avatar(c)}
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 16, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                      {sub(c) && <span style={{ display: "block", fontSize: 13, color: t.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub(c)}</span>}
                    </span>
                  </button>
                  <button onClick={() => (onClose(), placeCall({ id: c.linkedUserId!, name: c.name || "NetworQ member", avatar_url: c.image || null }, "audio"))} aria-label={`Call ${c.name}`} style={iconBtn}>
                    <I.Phone size={17} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {others.length > 0 && section("Not on NetworQ yet", "Invite them — once they join, you can message and call")}
          {others.length > 0 && (
            <ul aria-label="Contacts to invite" style={{ listStyle: "none", margin: 0, padding: 0, background: isDark ? "#2C2C2E" : "#F9F9FB", borderRadius: 18, overflow: "hidden" }}>
              {others.map((c, i) => (
                <li key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 14px", borderTop: i ? `1px solid ${t.line}` : "none" }}>
                  {avatar(c)}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 16, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name || "Unnamed"}</span>
                    {sub(c) && <span style={{ display: "block", fontSize: 13, color: t.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub(c)}</span>}
                  </span>
                  <button onClick={() => invite(c)} aria-label={`Invite ${c.name}`} style={{ flexShrink: 0, minHeight: 36, padding: "0 14px", borderRadius: 18, border: `1px solid ${isDark ? "rgba(167,139,250,0.4)" : "rgba(124,58,237,0.3)"}`, background: "transparent", color: isDark ? "#C4B5FD" : "#7C3AED", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                    {copied === c.id ? "Copied ✓" : "Invite"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!onApp.length && !others.length && (
            <div style={{ textAlign: "center", color: t.muted, padding: "48px 16px", fontSize: 15 }}>{contacts.length ? `No contacts match “${q}”.` : "You haven't added anyone yet. Scan a card or use Radar to add people."}</div>
          )}
        </div>
      </div>
    </div>
  );
}
