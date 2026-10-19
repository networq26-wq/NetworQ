// Report something objectionable from inside the app: a chat message, a person, or an AI answer.
// Reports go to content_reports (report_content RPC) and are reviewed in the admin panel (Safety).
// Required by Google Play's user-generated content and AI-generated content policies.
import React, { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

const REASONS = [
  { id: "spam", label: "Spam or scam" },
  { id: "harassment", label: "Harassment or bullying" },
  { id: "inappropriate", label: "Sexual or offensive content" },
  { id: "harmful", label: "Dangerous or harmful" },
  { id: "impersonation", label: "Pretending to be someone else" },
  { id: "other", label: "Something else" },
] as const;

export function ReportSheet({
  supabase,
  isDark,
  kind,
  subject,
  targetUser,
  targetName,
  messageId,
  content,
  onClose,
  onDone,
}: {
  supabase: SupabaseClient;
  isDark: boolean;
  kind: "message" | "user" | "ai";
  /** What is being reported, in words: "this message", "Bob Iyer", "this AI answer" */
  subject: string;
  targetUser?: string | null;
  targetName?: string | null;
  messageId?: string | null;
  content?: string | null;
  onClose: () => void;
  /** blocked = the person also chose to block */
  onDone: (result: { blocked: boolean }) => void;
}) {
  const [reason, setReason] = useState<string>("");
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(kind !== "ai");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = isDark
    ? { bg: "#1C1C1E", text: "#FFFFFF", muted: "#AEAEB2", line: "rgba(255,255,255,0.1)", field: "#2C2C2E" }
    : { bg: "#FFFFFF", text: "#1C1C1E", muted: "#6E6E73", line: "rgba(0,0,0,0.08)", field: "#F2F2F7" };
  const canBlock = kind !== "ai" && !!targetUser;

  const send = async () => {
    if (!reason) return setError("Choose what's wrong.");
    setBusy(true);
    setError("");
    const { error: e } = await supabase.rpc("report_content", {
      p_kind: kind,
      p_reason: reason,
      p_target_user: targetUser || null,
      p_message_id: messageId || null,
      p_details: details.trim() || null,
      p_content: content ? String(content).slice(0, 4000) : null,
    });
    if (e) {
      setBusy(false);
      return setError(/rate_limited/.test(e.message) ? "You've sent a lot of reports today. Please try again tomorrow." : "Couldn't send the report. Check your connection and try again.");
    }
    let blocked = false;
    if (canBlock && alsoBlock) blocked = !(await supabase.rpc("block_user", { p_user: targetUser })).error;
    setBusy(false);
    onDone({ blocked });
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 12 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Report"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 440, maxHeight: "85dvh", overflowY: "auto", background: t.bg, color: t.text, borderRadius: 24, padding: 20, marginBottom: "calc(var(--safe-bottom, env(safe-area-inset-bottom, 0px)) + 4px)", boxSizing: "border-box" }}
      >
        <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700 }}>Report {subject}</h2>
        <p style={{ margin: "0 0 12px", color: t.muted, fontSize: 15, lineHeight: 1.4 }}>
          {kind === "ai" ? "Tell us what was wrong with this answer. We use reports to make the AI safer." : "We review every report. The person isn't told who reported them."}
        </p>
        <div role="radiogroup" aria-label="What's wrong?">
          {REASONS.map((r) => (
            <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48, borderTop: `1px solid ${t.line}`, cursor: "pointer", fontSize: 16 }}>
              <input type="radio" name="report-reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} style={{ width: 22, height: 22, accentColor: "#7C3AED" }} />
              {r.label}
            </label>
          ))}
        </div>
        <label htmlFor="report-details" style={{ display: "block", fontSize: 15, fontWeight: 600, margin: "12px 0 6px" }}>
          Anything else? (optional)
        </label>
        <textarea
          id="report-details"
          value={details}
          onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
          rows={3}
          style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: "none", background: t.field, color: t.text, padding: 12, fontSize: 16, fontFamily: "inherit", resize: "vertical" }}
        />
        {canBlock && (
          <label style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48, marginTop: 8, cursor: "pointer", fontSize: 16 }}>
            <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} style={{ width: 22, height: 22, accentColor: "#7C3AED" }} />
            Also block {targetName || "this person"}
          </label>
        )}
        {error && <div role="alert" style={{ color: isDark ? "#FF6961" : "#D70015", fontSize: 15, marginTop: 8 }}>{error}</div>}
        <button onClick={send} disabled={busy} style={{ width: "100%", minHeight: 50, marginTop: 14, borderRadius: 16, border: "none", background: "#D70015", color: "#FFFFFF", fontSize: 16, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Sending…" : "Send report"}
        </button>
        <button onClick={onClose} style={{ width: "100%", minHeight: 44, marginTop: 8, borderRadius: 16, border: "none", background: "transparent", color: t.text, fontSize: 16, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
