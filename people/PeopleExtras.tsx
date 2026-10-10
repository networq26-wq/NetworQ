// People helpers: "Who's next" (who needs you, and why) and a sheet for messaging several people at once.
import React, { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createChatApi } from "../chat/chatApi";
import { I } from "../ui/icons";

type Person = {
  id?: string;
  name?: string;
  title?: string;
  company?: string;
  email?: string;
  reminder?: string;
  reminderDate?: string;
  reminderDone?: boolean;
  emailSent?: boolean;
  addedAt?: string;
  linkedUserId?: string | null;
  [k: string]: any;
};

const DAY = 86_400_000;
const FRESH_DAYS = 14;

function daysBetween(fromIso: string, toIso: string) {
  return Math.round((new Date(toIso + "T00:00:00").getTime() - new Date(fromIso.slice(0, 10) + "T00:00:00").getTime()) / DAY);
}

function ago(days: number) {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

// Who should you reach out to next? Overdue follow-ups first, then today's, then people you met recently but never emailed.
export function pickNext(people: Person[], today: string, limit = 3) {
  const due = people
    .filter((c) => c.reminderDate && !c.reminderDone && c.reminderDate <= today)
    .sort((a, b) => (a.reminderDate! < b.reminderDate! ? -1 : 1))
    .map((c) => {
      const late = daysBetween(c.reminderDate!, today);
      return { c, urgent: late > 0, reason: late > 0 ? `Follow-up overdue · ${late} day${late === 1 ? "" : "s"}` : "Follow-up due today" };
    });
  const dueIds = new Set(due.map((d) => d.c.id));
  const fresh = people
    .filter((c) => !dueIds.has(c.id) && c.email && !c.emailSent && c.addedAt && daysBetween(c.addedAt, today) <= FRESH_DAYS)
    .sort((a, b) => (a.addedAt! > b.addedAt! ? -1 : 1))
    .map((c) => ({ c, urgent: false, reason: `Met ${ago(daysBetween(c.addedAt!, today))} · no email yet` }));
  return [...due, ...fresh].slice(0, limit);
}

export function WhoNext({
  people,
  today,
  isDark,
  onOpen,
  onEmail,
  onMessage,
}: {
  people: Person[];
  today: string;
  isDark: boolean;
  onOpen: (c: Person) => void;
  onEmail: (c: Person) => void;
  onMessage: (c: Person) => void;
}) {
  const next = useMemo(() => pickNext(people, today), [people, today]);
  if (!next.length) return null;
  const t = isDark
    ? { surface: "#1C1C1E", text: "#FFFFFF", muted: "#AEAEB2", sep: "rgba(255,255,255,0.08)" }
    : { surface: "#FFFFFF", text: "#1C1C1E", muted: "#6E6E73", sep: "rgba(0,0,0,0.06)" };
  return (
    <section aria-label="Who's next" style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 2px" }}>Who's next</h2>
      <div style={{ fontSize: 15, color: t.muted, margin: "0 0 12px" }}>People waiting to hear from you</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, background: t.surface, border: `1px solid ${t.sep}`, borderRadius: 20, overflow: "hidden" }}>
        {next.map(({ c, urgent, reason }, i) => {
          const canEmail = !!c.email;
          const canMessage = !canEmail && !!c.linkedUserId;
          return (
            <li key={c.id || i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 12px 12px 16px", minHeight: 64, borderTop: i ? `1px solid ${t.sep}` : "none" }}>
              <button onClick={() => onOpen(c)} aria-label={`Open ${c.name}`} style={{ all: "unset", boxSizing: "border-box", flex: 1, minWidth: 0, minHeight: 44, cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: urgent ? "#FF3B30" : reason.startsWith("Follow-up") ? "#FF9F0A" : "#7C3AED" }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 16, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name || "Unnamed"}</span>
                  <span style={{ display: "block", fontSize: 15, color: urgent ? "#FF3B30" : t.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reason}</span>
                </span>
              </button>
              {(canEmail || canMessage) && (
                <button
                  onClick={() => (canEmail ? onEmail(c) : onMessage(c))}
                  className="btn-press"
                  style={{ flexShrink: 0, minHeight: 44, padding: "0 16px", borderRadius: 18, border: "none", background: "#7C3AED", color: "#FFFFFF", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <I.Mail size={16} />
                  {canEmail ? "Email" : "Message"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// One message to several people in NetworQ chat. Only people with a NetworQ account (and connected with you) can receive it.
export function GroupMessageSheet({
  supabase,
  people,
  isDark,
  onClose,
  onDone,
}: {
  supabase: SupabaseClient;
  people: Person[];
  isDark: boolean;
  onClose: () => void;
  onDone: (sent: number, failed: number) => void;
}) {
  const api = useMemo(() => createChatApi(supabase), [supabase]);
  const reachable = people.filter((p) => p.linkedUserId);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const t = isDark
    ? { surface: "#1C1C1E", raised: "#2C2C2E", text: "#FFFFFF", muted: "#AEAEB2", sep: "rgba(255,255,255,0.1)" }
    : { surface: "#FFFFFF", raised: "#F2F2F7", text: "#1C1C1E", muted: "#6E6E73", sep: "rgba(0,0,0,0.08)" };

  const send = async () => {
    const content = text.trim();
    if (!content || !reachable.length || sending) return;
    setSending(true);
    setError(null);
    let sent = 0;
    let failed = 0;
    let lastErr: unknown = null;
    for (const p of reachable) {
      try {
        await api.sendMessage({ recipientId: p.linkedUserId!, content });
        sent++;
      } catch (e) {
        failed++;
        lastErr = e;
      }
      setProgress(sent + failed);
    }
    setSending(false);
    if (failed && !sent) return setError((lastErr as Error)?.message || "Couldn't send. Try again.");
    onDone(sent, failed);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Message people" style={{ position: "fixed", inset: 0, zIndex: 400, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div className="nq-backdrop" onClick={() => !sending && onClose()} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} />
      <div className="nq-sheet-up" style={{ position: "relative", width: "100%", maxWidth: 560, background: t.surface, color: t.text, borderRadius: "28px 28px 0 0", padding: "10px 20px calc(20px + var(--safe-bottom, env(safe-area-inset-bottom, 0px)))", boxSizing: "border-box" }}>
        <div aria-hidden style={{ width: 36, height: 5, borderRadius: 3, background: t.sep, margin: "0 auto 14px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Message {reachable.length} {reachable.length === 1 ? "person" : "people"}</h3>
          <button onClick={onClose} disabled={sending} aria-label="Close" style={{ width: 44, height: 44, borderRadius: 16, border: "none", background: t.raised, color: t.muted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <I.X size={16} />
          </button>
        </div>
        <p style={{ margin: "6px 0 14px", fontSize: 15, color: t.muted, lineHeight: 1.45 }}>
          Each person gets it as a private message in NetworQ.
          {people.length > reachable.length && ` ${people.length - reachable.length} of the people you picked aren't on NetworQ yet — email them instead.`}
        </p>
        {reachable.length > 0 ? (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write your message…"
              aria-label="Message"
              rows={4}
              maxLength={2000}
              autoFocus
              style={{ width: "100%", boxSizing: "border-box", resize: "none", borderRadius: 16, border: `1px solid ${t.sep}`, background: t.raised, color: t.text, padding: "12px 14px", fontSize: 16, lineHeight: 1.4, fontFamily: "inherit", outline: "none" }}
            />
            {error && <div role="alert" style={{ color: "#FF3B30", fontSize: 15, marginTop: 8 }}>{error}</div>}
            <button
              onClick={send}
              disabled={!text.trim() || sending}
              style={{ marginTop: 14, width: "100%", minHeight: 52, borderRadius: 16, border: "none", background: "#7C3AED", color: "#FFFFFF", fontSize: 17, fontWeight: 600, cursor: text.trim() && !sending ? "pointer" : "default", opacity: text.trim() && !sending ? 1 : 0.5 }}
            >
              {sending ? `Sending ${progress} of ${reachable.length}…` : "Send"}
            </button>
          </>
        ) : (
          <button onClick={onClose} style={{ width: "100%", minHeight: 52, borderRadius: 16, border: "none", background: t.raised, color: t.text, fontSize: 17, fontWeight: 600, cursor: "pointer" }}>
            OK
          </button>
        )}
      </div>
    </div>
  );
}
