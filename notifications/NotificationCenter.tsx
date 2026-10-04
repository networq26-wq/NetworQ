// Notification centre sheet: newest first, tap to open the right screen.
import React, { useEffect } from "react";
import { I } from "../ui/icons";
import type { AppNotification } from "./useNotifications";

const PURPLE = "#7C3AED";

function ago(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const ICON: Record<string, { Icon: (p: { size?: number; color?: string }) => React.ReactElement; color: string }> = {
  connection_request: { Icon: I.UserPlus, color: "#7C3AED" },
  connection_accepted: { Icon: I.UserCheck, color: "#34C759" },
  connection_declined: { Icon: I.User, color: "#8E8E93" },
  reminder: { Icon: I.Clock, color: "#FF9F0A" },
  security: { Icon: I.Lock, color: "#FF3B30" },
  event: { Icon: I.Calendar, color: "#0A84FF" },
  system: { Icon: I.Bell, color: "#8E8E93" },
};

export function NotificationCenter({
  isDark,
  items,
  onOpen,
  onMarkAllRead,
  onClose,
  dueReminders,
  onOpenReminders,
  topSlot,
}: {
  isDark: boolean;
  items: AppNotification[];
  onOpen: (n: AppNotification) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
  dueReminders: number;
  onOpenReminders: () => void;
  topSlot?: React.ReactNode;
}) {
  const t = isDark
    ? { surface: "#1C1C1E", raised: "#2C2C2E", text: "#FFFFFF", muted: "#AEAEB2", border: "rgba(255,255,255,0.08)" }
    : { surface: "#FFFFFF", raised: "#F2F2F7", text: "#1C1C1E", muted: "#6E6E73", border: "rgba(0,0,0,0.08)" };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <div onClick={onClose} className="nq-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1100, display: "flex", justifyContent: "flex-end" }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        className="nq-sheet-right"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 420, height: "100%", background: t.surface, color: t.text, display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 16px 8px" }}>
          <h2 style={{ margin: 0, fontSize: 22, flex: 1 }}>Notifications</h2>
          {unread > 0 && (
            <button onClick={onMarkAllRead} style={{ border: "none", background: "none", color: PURPLE, fontWeight: 600, fontSize: 14, minHeight: 44, cursor: "pointer" }}>
              Mark all read
            </button>
          )}
          <button aria-label="Close" onClick={onClose} style={{ width: 44, height: 44, borderRadius: 22, border: "none", background: t.raised, color: t.text, fontSize: 20, cursor: "pointer" }}>
            ×
          </button>
        </div>

        {topSlot}
        {dueReminders > 0 && (
          <button
            onClick={onOpenReminders}
            style={{ margin: "4px 16px 8px", padding: "12px 14px", borderRadius: 14, border: `1px solid ${t.border}`, background: t.raised, color: t.text, textAlign: "left", cursor: "pointer", fontSize: 14 }}
          >
            <I.Clock size={16} style={{ marginRight: 6, verticalAlign: "-3px" }} /><strong>{dueReminders}</strong> follow-up reminder{dueReminders === 1 ? "" : "s"} due
          </button>
        )}

        <div style={{ overflowY: "auto", flex: 1, padding: "0 8px 24px" }}>
          {items.length === 0 ? (
            <div style={{ textAlign: "center", color: t.muted, padding: "48px 24px" }}>
              <div style={{ width: 56, height: 56, borderRadius: 28, margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center", background: t.raised }}><I.Bell size={26} /></div>
              You're all caught up. Connection requests and updates appear here.
            </div>
          ) : (
            <ul aria-label="Notification list" className="nq-stagger" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => onOpen(n)}
                    style={{ width: "100%", display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 10px", border: "none", borderRadius: 14, background: n.read_at ? "transparent" : isDark ? "rgba(124,58,237,0.12)" : "rgba(124,58,237,0.06)", color: t.text, textAlign: "left", cursor: "pointer", marginBottom: 2 }}
                  >
                    {(() => {
                      const { Icon, color } = ICON[n.type] || ICON.system;
                      return (
                        <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 17, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `${color}1F`, color }}>
                          <Icon size={18} />
                        </span>
                      );
                    })()}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: n.read_at ? 500 : 700, fontSize: 15 }}>{n.title}</span>
                      {n.body && <span style={{ display: "block", color: t.muted, fontSize: 13, marginTop: 2 }}>{n.body}</span>}
                    </span>
                    <span style={{ color: t.muted, fontSize: 12, whiteSpace: "nowrap" }}>{ago(n.created_at)}</span>
                    {!n.read_at && <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: 4, background: PURPLE, marginTop: 6 }} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
