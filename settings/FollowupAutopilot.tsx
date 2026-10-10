// Follow-up autopilot settings: one switch to turn it on, the schedule, a signature, a preview of
// what will be sent, and what was sent / is coming up. Sending itself happens on the server.
import React, { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

const SCHEDULES: { days: number[]; label: string; hint: string }[] = [
  { days: [1, 7, 30], label: "Day 1, 7 and 30", hint: "Recommended" },
  { days: [1, 14], label: "Day 1 and 14", hint: "Lighter" },
  { days: [2, 10, 30], label: "Day 2, 10 and 30", hint: "More relaxed" },
];
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const fmt = (t?: string | null) =>
  t ? new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

type Settings = { enabled: boolean; days: number[]; signature: string };
type LogRow = { id: string; to_email: string; subject: string | null; status: string; step: number; created_at: string; error: string | null };
type Upcoming = { id: string; name: string; email: string; autopilot_step: number; autopilot_next_at: string };

function theme(isDark: boolean) {
  return isDark
    ? { surface: "#1C1C1E", raised: "#2C2C2E", text: "#FFFFFF", muted: "#AEAEB2", border: "rgba(255,255,255,0.08)" }
    : { surface: "#FFFFFF", raised: "#F2F2F7", text: "#1C1C1E", muted: "#6E6E73", border: "rgba(0,0,0,0.08)" };
}

export function FollowupAutopilot({
  supabase,
  isDark,
  apiBaseUrl = "",
  showToast,
}: {
  supabase: SupabaseClient;
  isDark: boolean;
  apiBaseUrl?: string;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const t = theme(isDark);
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [signature, setSignature] = useState("");
  const [log, setLog] = useState<LogRow[]>([]);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [preview, setPreview] = useState<{ to: string; subject: string; body: string; day: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;
    const [{ data: p, error: pe }, { data: l }, { data: u }] = await Promise.all([
      supabase.from("profiles").select("autopilot_enabled, autopilot_days, autopilot_signature").eq("id", uid).maybeSingle(),
      supabase.from("followup_log").select("id, to_email, subject, status, step, created_at, error").order("created_at", { ascending: false }).limit(20),
      supabase.from("contacts").select("id, name, email, autopilot_step, autopilot_next_at").eq("user_id", uid).eq("autopilot_status", "active").not("email", "is", null).order("autopilot_next_at", { ascending: true }).limit(5),
    ]);
    if (pe) {
      setError("Couldn't load your autopilot settings. Please try again.");
      return;
    }
    const next = { enabled: !!p?.autopilot_enabled, days: p?.autopilot_days?.length ? p.autopilot_days : [1, 7, 30], signature: p?.autopilot_signature || "" };
    setS(next);
    setSignature(next.signature);
    setLog((l as LogRow[]) || []);
    setUpcoming(((u as Upcoming[]) || []).filter((x) => x.autopilot_next_at));
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch: Partial<Settings>, okMsg?: string) => {
    if (!s) return;
    setSaving(true);
    const next = { ...s, ...patch };
    const { data, error: e } = await supabase.rpc("set_autopilot", { p_enabled: next.enabled, p_days: next.days, p_signature: next.signature ?? "" });
    setSaving(false);
    if (e) return showToast("Couldn't save. Please try again.", "error");
    setS({ enabled: data.enabled, days: data.days, signature: data.signature || "" });
    if (okMsg) showToast(okMsg, "success");
    load();
  };

  const showPreview = async () => {
    setPreviewing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const r = await fetch(`${apiBaseUrl}/api/followups/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` },
        body: JSON.stringify({ step: 0 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't make a preview.");
      setPreview(j);
    } catch (e: any) {
      showToast(e.message || "Couldn't make a preview.", "error");
    } finally {
      setPreviewing(false);
    }
  };

  const card: React.CSSProperties = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 18, padding: 20 };
  const btn = (kind: "primary" | "ghost"): React.CSSProperties => ({
    minHeight: 48, padding: "0 18px", borderRadius: 14, fontSize: 16, fontWeight: 600, cursor: "pointer",
    border: kind === "primary" ? "none" : `1px solid ${t.border}`, background: kind === "primary" ? "#7C3AED" : t.raised, color: kind === "primary" ? "#FFF" : t.text,
  });

  if (error) return <div role="alert" style={{ ...card, color: "#DC2626" }}>{error}</div>;
  if (!s) return <div style={{ ...card, color: t.muted }}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, color: t.text }}>
      <section style={card} aria-labelledby="ap-title">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 id="ap-title" style={{ margin: 0, fontSize: 19 }}>Send my follow-ups automatically</h3>
            <p style={{ margin: "6px 0 0", color: t.muted, fontSize: 15, lineHeight: 1.5 }}>
              NetworQ writes a short, personal email from your notes and sends it for you — so nobody you meet goes cold. Replies come straight to your inbox.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={s.enabled}
            aria-labelledby="ap-title"
            disabled={saving}
            onClick={() => save({ enabled: !s.enabled }, !s.enabled ? "Autopilot is on. Follow-ups will go out on schedule." : "Autopilot is off. Nothing more will be sent.")}
            style={{ flex: "none", width: 60, height: 36, borderRadius: 18, border: "none", cursor: "pointer", position: "relative", background: s.enabled ? "#34C759" : isDark ? "#3A3A3C" : "#D1D1D6", transition: "background 0.2s" }}
          >
            <span aria-hidden style={{ position: "absolute", top: 3, left: s.enabled ? 27 : 3, width: 30, height: 30, borderRadius: 15, background: "#FFF", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", transition: "left 0.2s" }} />
          </button>
        </div>
        <div role="status" style={{ marginTop: 14, padding: "10px 14px", borderRadius: 12, fontSize: 15, background: s.enabled ? "rgba(52,199,89,0.12)" : t.raised, color: s.enabled ? "#1F8A3B" : t.muted }}>
          {s.enabled ? "On — follow-ups are sent automatically." : "Off — nothing is sent until you turn it on."}
        </div>
      </section>

      <section style={card} aria-labelledby="ap-when">
        <h3 id="ap-when" style={{ margin: "0 0 4px", fontSize: 17 }}>When</h3>
        <p style={{ margin: "0 0 12px", color: t.muted, fontSize: 14 }}>Days after you add someone. It stops early if you mark them as replied or pause them.</p>
        <div role="radiogroup" aria-labelledby="ap-when" style={{ display: "grid", gap: 8 }}>
          {SCHEDULES.map((o) => {
            const on = same(o.days, s.days);
            return (
              <button
                key={o.label}
                role="radio"
                aria-checked={on}
                disabled={saving}
                onClick={() => !on && save({ days: o.days }, "Schedule updated.")}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 52, padding: "0 16px", borderRadius: 14, cursor: "pointer", fontSize: 16, textAlign: "left", border: `2px solid ${on ? "#7C3AED" : t.border}`, background: on ? (isDark ? "rgba(124,58,237,0.18)" : "#F5F0FF") : t.surface, color: t.text }}
              >
                <span>{o.label}</span>
                <span style={{ fontSize: 13, color: on ? "#7C3AED" : t.muted, fontWeight: 600 }}>{o.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section style={card} aria-labelledby="ap-sig">
        <h3 id="ap-sig" style={{ margin: "0 0 4px", fontSize: 17 }}>Signature</h3>
        <p style={{ margin: "0 0 10px", color: t.muted, fontSize: 14 }}>Added under every email (optional).</p>
        <textarea
          aria-labelledby="ap-sig"
          value={signature}
          maxLength={500}
          placeholder={"Asha Rao\nFounder, Acme Labs · acme.io"}
          onChange={(e) => setSignature(e.target.value)}
          style={{ width: "100%", minHeight: 84, borderRadius: 12, border: `1px solid ${t.border}`, background: t.raised, color: t.text, padding: 12, fontSize: 16, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button style={btn("primary")} disabled={saving || signature === s.signature} onClick={() => save({ signature }, "Signature saved.")}>Save signature</button>
          <button style={btn("ghost")} disabled={previewing} onClick={showPreview}>{previewing ? "Writing…" : "Preview an email"}</button>
        </div>
        {preview && (
          <div aria-live="polite" style={{ marginTop: 14, padding: 16, borderRadius: 14, background: t.raised, fontSize: 15, lineHeight: 1.55 }}>
            <div style={{ color: t.muted, fontSize: 13, marginBottom: 6 }}>Example for {preview.to} · day {preview.day} · not sent</div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{preview.subject}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{preview.body}</div>
          </div>
        )}
      </section>

      <section style={card} aria-labelledby="ap-next">
        <h3 id="ap-next" style={{ margin: "0 0 10px", fontSize: 17 }}>Coming up</h3>
        {upcoming.length ? (
          upcoming.map((u) => (
            <div key={u.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: `1px solid ${t.border}`, fontSize: 15 }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
              <span style={{ color: t.muted, flex: "none" }}>{s.enabled ? fmt(u.autopilot_next_at) : "Paused (autopilot off)"}</span>
            </div>
          ))
        ) : (
          <p style={{ margin: 0, color: t.muted, fontSize: 15 }}>Nothing scheduled. Add a contact with an email address and their first follow-up will be planned.</p>
        )}
      </section>

      <section style={card} aria-labelledby="ap-sent">
        <h3 id="ap-sent" style={{ margin: "0 0 10px", fontSize: 17 }}>Sent recently</h3>
        {log.length ? (
          log.map((l) => (
            <div key={l.id} style={{ padding: "10px 0", borderTop: `1px solid ${t.border}`, fontSize: 15 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.to_email}</span>
                <span style={{ flex: "none", fontSize: 13, fontWeight: 600, color: l.status === "sent" ? "#1F8A3B" : l.status === "failed" ? "#DC2626" : t.muted }}>
                  {l.status === "sent" ? "Sent" : l.status === "failed" ? "Didn't send" : "Skipped"}
                </span>
              </div>
              <div style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>
                {l.subject || l.error || ""} · {fmt(l.created_at)}
              </div>
            </div>
          ))
        ) : (
          <p style={{ margin: 0, color: t.muted, fontSize: 15 }}>No follow-ups sent yet.</p>
        )}
      </section>
      <p style={{ margin: "0 4px", color: t.muted, fontSize: 13, lineHeight: 1.5 }}>
        Emails go out as “Your name via NetworQ” with replies to your own email address. Every email has an unsubscribe link, and at most 25 are sent per day.
      </p>
    </div>
  );
}
