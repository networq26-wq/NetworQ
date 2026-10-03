// A contact's email history: what was sent, when, and whether they replied (set by the user —
// NetworQ can't see the recipient's inbox, so reply status is never guessed).
import React, { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPTION_LABELS } from "./prospectApi";

interface Row {
  id: string;
  subject: string | null;
  draft: string | null;
  sent_at: string | null;
  created_at: string;
  draft_option: string | null;
  reply_status: "none" | "replied" | "no_reply";
  value_props: string[] | null;
  email_type: string | null;
}

export function OutreachTimeline({
  supabase,
  contactId,
  isDark,
  refreshKey,
  onFollowUp,
}: {
  supabase: SupabaseClient;
  contactId: string;
  isDark: boolean;
  refreshKey?: number;
  onFollowUp: () => void;
}) {
  const muted = isDark ? "#AEAEB2" : "#6E6E73";
  const subtle = isDark ? "rgba(255,255,255,0.05)" : "#F5F5F7";
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from("follow_up_emails")
      .select("id, subject, draft, sent_at, created_at, draft_option, reply_status, value_props, email_type")
      .eq("contact_id", contactId)
      .eq("sent", true)
      .order("created_at", { ascending: false })
      .then(({ data }) => alive && setRows((data as Row[]) || []));
    return () => {
      alive = false;
    };
  }, [supabase, contactId, refreshKey]);

  const setReply = async (id: string, reply_status: Row["reply_status"]) => {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, reply_status } : x)));
    await supabase.from("follow_up_emails").update({ reply_status }).eq("id", id);
  };

  if (!rows.length) return null;
  const awaiting = rows[0].reply_status !== "replied";

  return (
    <div style={{ background: subtle, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }} aria-label="Email timeline">
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: muted, letterSpacing: "0.06em", textTransform: "uppercase", flex: 1 }}>EMAILS · {rows.length}</span>
        {awaiting && (
          <button onClick={onFollowUp} style={{ border: "none", background: "none", color: "#7C3AED", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
            Write follow-up
          </button>
        )}
      </div>
      {rows.map((r) => (
        <div key={r.id} style={{ borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`, marginTop: 8, paddingTop: 8 }}>
          <button onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id} style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{r.subject || "(no subject)"}</div>
            <div style={{ fontSize: 11, color: muted, marginTop: 2 }}>
              {new Date(r.sent_at || r.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
              {r.draft_option ? ` · ${OPTION_LABELS[r.draft_option] || r.draft_option}` : ""}
              {r.value_props?.length ? ` · ${r.value_props.join(", ")}` : ""}
            </div>
          </button>
          {open === r.id && <div style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.5, marginTop: 6 }}>{r.draft}</div>}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }} role="radiogroup" aria-label={`Reply status for ${r.subject || "email"}`}>
            {(
              [
                ["none", "Waiting"],
                ["replied", "Replied"],
                ["no_reply", "No reply"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={r.reply_status === k} onClick={() => setReply(r.id, k)} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, cursor: "pointer", border: `1px solid ${r.reply_status === k ? "#7C3AED" : "transparent"}`, background: r.reply_status === k ? "rgba(124,58,237,0.12)" : "transparent", color: r.reply_status === k ? "#7C3AED" : muted }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
