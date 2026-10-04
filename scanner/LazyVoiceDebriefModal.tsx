// Voice note: say who you met and what's next → we write it down → you check the details → saved
// as a contact with a follow-up reminder. Three plain steps; nothing is invented.
import React, { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { I, SuccessCheck } from "../ui/icons";
import { useVoiceRecorder } from "../voice/useVoiceRecorder";

export interface LazyDebriefResult {
  name: string;
  role?: string;
  company?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  summary?: string;
  commitment?: string;
  reminder_days?: number;
  email_draft?: { subject: string; body: string };
}

type Step = "talk" | "review" | "saved";
const REMIND = [
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "In a week", days: 7 },
  { label: "No reminder", days: 0 },
];
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export function LazyVoiceDebriefModal({
  open,
  onClose,
  supabase,
  currentUser,
  isDark,
  showToast,
  onContactCreated,
  apiBaseUrl,
}: {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  currentUser: any;
  isDark: boolean;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  onContactCreated?: (contact: any) => void;
  apiBaseUrl?: string;
}) {
  const [step, setStep] = useState<Step>("talk");
  const [transcript, setTranscript] = useState("");
  const [typing, setTyping] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", role: "", company: "", email: "", phone: "", notes: "", followUp: "" });
  const [remindDays, setRemindDays] = useState(3);
  const [draft, setDraft] = useState<LazyDebriefResult["email_draft"] | null>(null);
  const [saved, setSaved] = useState<{ name: string; remindOn: string | null } | null>(null);
  const base = (apiBaseUrl || "").replace(/\/$/, "");

  const voice = useVoiceRecorder({
    supabase,
    apiBaseUrl: base,
    onText: (t) => setTranscript((prev) => (prev ? `${prev} ${t}` : t)),
  });

  const t = isDark
    ? { sheet: "#1C1C1E", raised: "#2C2C2E", text: "#FFFFFF", muted: "#AEAEB2", line: "rgba(255,255,255,0.1)" }
    : { sheet: "#FFFFFF", raised: "#F2F2F7", text: "#1C1C1E", muted: "#6E6E73", line: "rgba(0,0,0,0.08)" };

  if (!open) return null;

  const reset = () => {
    voice.cancel();
    setStep("talk");
    setTranscript("");
    setTyping(false);
    setForm({ name: "", role: "", company: "", email: "", phone: "", notes: "", followUp: "" });
    setRemindDays(3);
    setDraft(null);
    setSaved(null);
  };
  const close = () => {
    voice.cancel();
    onClose();
  };

  // Pull name / company / next step out of what was said. If the AI can't, you fill them in — we never guess.
  const findDetails = async () => {
    const said = transcript.trim();
    if (!said) return;
    setExtracting(true);
    let parsed: Partial<LazyDebriefResult> = {};
    try {
      const { data: sess } = await supabase.auth.getSession();
      const r = await fetch(`${base}/api/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess?.session?.access_token || ""}` },
        body: JSON.stringify({
          action: "lazy_debrief",
          max_tokens: 700,
          messages: [
            {
              role: "system",
              content:
                'Extract details from a voice note about a person the user just met. Reply with JSON only: {"name":string,"role":string,"company":string,"email":string,"phone":string,"tags":string[],"summary":string,"commitment":string,"reminder_days":number,"email_draft":{"subject":string,"body":string}}. Use "" for anything not said — never invent names, emails or numbers. "summary" is 1-2 sentences of what was discussed. "commitment" is the agreed next step, if any. reminder_days: whole days from today until the follow-up (default 3). Today is ' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '.',
            },
            { role: "user", content: said },
          ],
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "AI unavailable");
      const raw = d?.choices?.[0]?.message?.content || "";
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    } catch {
      showToast("Couldn't pick out the details automatically — please fill them in.", "info");
    }
    setForm({
      name: (parsed.name || "").trim(),
      role: (parsed.role || "").trim(),
      company: (parsed.company || "").trim(),
      email: (parsed.email || "").trim(),
      phone: (parsed.phone || "").trim(),
      notes: (parsed.summary || said).trim(),
      followUp: (parsed.commitment || "").trim(),
    });
    const days = Math.round(Number(parsed.reminder_days));
    setRemindDays(days > 0 && days <= 60 ? days : 3);
    setDraft(parsed.email_draft?.body ? parsed.email_draft : null);
    setExtracting(false);
    setStep("review");
  };

  const save = async () => {
    if (!form.name.trim()) return showToast("Add the person's name first.", "error");
    if (!currentUser?.id) return showToast("Please sign in again.", "error");
    setSaving(true);
    const remindOn = remindDays ? isoDay(new Date(Date.now() + remindDays * 86400000)) : null;
    const row = {
      user_id: currentUser.id,
      name: form.name.trim(),
      title: form.role.trim() || null,
      company: form.company.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      reference: form.notes.trim() || null,
      tags: ["voice note"],
      reminder: remindOn ? form.followUp.trim() || `Follow up with ${form.name.trim()}` : null,
      reminder_date: remindOn,
      reminder_done: false,
    };
    const { data, error } = await supabase.from("contacts").insert(row).select().single();
    setSaving(false);
    if (error || !data) return showToast(`Couldn't save: ${error?.message || "please try again"}`, "error");
    onContactCreated?.(data);
    setSaved({ name: row.name, remindOn });
    setStep("saved");
  };

  const field = (key: keyof typeof form, label: string, opts: { type?: string; placeholder?: string; multiline?: boolean } = {}) => (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 13, color: t.muted, margin: "0 0 6px 2px" }}>{label}</span>
      {opts.multiline ? (
        <textarea
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          rows={3}
          placeholder={opts.placeholder}
          style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: `1px solid ${t.line}`, background: t.raised, color: t.text, padding: "12px 14px", fontSize: 16, fontFamily: "inherit", resize: "none", lineHeight: 1.4 }}
        />
      ) : (
        <input
          value={form[key]}
          type={opts.type || "text"}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          placeholder={opts.placeholder}
          style={{ width: "100%", boxSizing: "border-box", minHeight: 48, borderRadius: 14, border: `1px solid ${t.line}`, background: t.raised, color: t.text, padding: "0 14px", fontSize: 16, fontFamily: "inherit" }}
        />
      )}
    </label>
  );

  // The day you mentioned ("remind me Thursday") shows as its own choice
  const remindOptions = [1, 3, 7, 0].includes(remindDays)
    ? REMIND
    : [{ label: new Date(Date.now() + remindDays * 86400000).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }), days: remindDays }, ...REMIND.filter((r) => r.days !== 3)];
  const recording = voice.state === "recording";
  const busy = voice.state === "starting" || voice.state === "transcribing";
  const primaryBtn = (enabled: boolean): React.CSSProperties => ({ width: "100%", minHeight: 52, borderRadius: 16, border: "none", background: "#7C3AED", color: "#FFFFFF", fontSize: 17, fontWeight: 600, cursor: enabled ? "pointer" : "default", opacity: enabled ? 1 : 0.5, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 });
  const secondaryBtn: React.CSSProperties = { width: "100%", minHeight: 48, borderRadius: 16, border: "none", background: t.raised, color: t.text, fontSize: 16, fontWeight: 600, cursor: "pointer" };

  return (
    <div role="dialog" aria-modal="true" aria-label="Voice note" style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div className="nq-backdrop" onClick={close} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} />
      <div
        className="nq-sheet-up"
        style={{ position: "relative", width: "100%", maxWidth: 560, maxHeight: "92dvh", overflowY: "auto", background: t.sheet, color: t.text, borderRadius: "28px 28px 0 0", padding: "10px 20px calc(24px + var(--safe-bottom, env(safe-area-inset-bottom, 0px)))", boxSizing: "border-box" }}
      >
        <div aria-hidden style={{ width: 36, height: 5, borderRadius: 3, background: t.line, margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{step === "review" ? "Check the details" : step === "saved" ? "Saved" : "Voice note"}</h3>
          <button onClick={close} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 16, border: "none", background: t.raised, color: t.muted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <I.X size={16} />
          </button>
        </div>

        {step === "talk" && (
          <>
            <p style={{ margin: "0 0 20px", fontSize: 15, color: t.muted, lineHeight: 1.45 }}>Say who you met and what to do next. We'll write it down and save them for you.</p>

            {/* Big mic: tap to start, tap to finish */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "8px 0 20px" }}>
              <button
                onClick={recording ? voice.stop : voice.start}
                disabled={busy}
                aria-label={recording ? "Stop recording" : "Start recording"}
                className="btn-press"
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  border: "none",
                  cursor: busy ? "default" : "pointer",
                  color: "#FFFFFF",
                  background: recording ? "#FF3B30" : "#7C3AED",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: recording ? `0 0 0 ${6 + voice.level * 26}px rgba(255,59,48,0.18)` : "0 10px 28px -8px rgba(124,58,237,0.6)",
                  transition: "box-shadow 0.08s linear, background 0.2s ease",
                }}
              >
                {recording ? <span style={{ width: 26, height: 26, borderRadius: 6, background: "#FFFFFF" }} /> : voice.state === "transcribing" ? <span className="nq-spin" style={{ width: 30, height: 30, borderRadius: 15, border: "3px solid rgba(255,255,255,0.35)", borderTopColor: "#FFFFFF" }} /> : <I.Mic size={38} />}
              </button>

              {/* Live level meter: proof that we can hear you */}
              <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 4, height: 28 }}>
                {[0.55, 0.8, 1, 0.8, 0.55].map((k, i) => (
                  <span key={i} style={{ width: 5, borderRadius: 3, background: recording ? "#FF3B30" : t.line, height: recording ? Math.max(6, Math.min(28, 6 + voice.level * 40 * k)) : 6, transition: "height 0.08s linear" }} />
                ))}
              </div>

              <div role="status" aria-live="polite" style={{ fontSize: 16, fontWeight: 600, textAlign: "center", minHeight: 22 }}>
                {voice.state === "starting"
                  ? "Starting the microphone…"
                  : recording
                    ? `Listening… ${mmss(voice.elapsed)}`
                    : voice.state === "transcribing"
                      ? "Writing it down…"
                      : transcript
                        ? "Got it. Add more, or continue."
                        : "Tap the mic and start talking"}
              </div>
              {recording && !voice.heard && voice.elapsed > 3500 && (
                <div style={{ fontSize: 14, color: "#FF9F0A", textAlign: "center" }}>We can't hear you yet — speak closer to the phone.</div>
              )}
              {recording && <div style={{ fontSize: 13, color: t.muted }}>Tap the red button when you're done</div>}
              {!recording && !transcript && voice.state === "idle" && (
                <div style={{ fontSize: 14, color: t.muted, textAlign: "center", maxWidth: 320, lineHeight: 1.45 }}>
                  e.g. “Met Priya, head of growth at Zoho. Wants a demo next week. Remind me Thursday.”
                </div>
              )}
            </div>

            {voice.state === "error" && voice.error && (
              <div role="alert" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 14, background: isDark ? "rgba(255,59,48,0.14)" : "#FFF1F0", color: isDark ? "#FF8A80" : "#C62828", fontSize: 14, lineHeight: 1.4, marginBottom: 14 }}>
                <I.Alert size={18} />
                <span style={{ flex: 1 }}>{voice.error}</span>
              </div>
            )}

            {(transcript || typing) && (
              <label style={{ display: "block", marginBottom: 14 }}>
                <span style={{ display: "block", fontSize: 13, color: t.muted, margin: "0 0 6px 2px" }}>What you said (you can edit it)</span>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  rows={4}
                  autoFocus={typing && !transcript}
                  placeholder="Type who you met and what's next…"
                  style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: `1px solid ${t.line}`, background: t.raised, color: t.text, padding: "12px 14px", fontSize: 16, fontFamily: "inherit", resize: "none", lineHeight: 1.45 }}
                />
              </label>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={findDetails} disabled={!transcript.trim() || extracting || recording || busy} style={primaryBtn(!!transcript.trim() && !extracting && !recording && !busy)}>
                {extracting ? (
                  <>
                    <span className="nq-spin" style={{ width: 18, height: 18, borderRadius: 9, border: "2px solid rgba(255,255,255,0.35)", borderTopColor: "#FFFFFF" }} /> Finding the details…
                  </>
                ) : (
                  "Continue"
                )}
              </button>
              {!transcript && !typing && !recording && (
                <button onClick={() => setTyping(true)} style={{ border: "none", background: "none", color: isDark ? "#C4B5FD" : "#7C3AED", fontSize: 15, fontWeight: 600, cursor: "pointer", minHeight: 40 }}>
                  Type it instead
                </button>
              )}
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <p style={{ margin: "0 0 16px", fontSize: 15, color: t.muted, lineHeight: 1.45 }}>Here's what we picked up. Fix anything, then save.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {field("name", "Name", { placeholder: "Who did you meet?" })}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {field("role", "Role", { placeholder: "e.g. Founder" })}
                {field("company", "Company")}
              </div>
              {field("email", "Email", { type: "email" })}
              {field("phone", "Phone", { type: "tel" })}
              {field("notes", "Notes", { multiline: true })}
              {field("followUp", "Next step", { placeholder: "e.g. Send the demo link" })}
              <div>
                <span style={{ display: "block", fontSize: 13, color: t.muted, margin: "0 0 6px 2px" }}>Remind me</span>
                <div role="radiogroup" aria-label="Remind me" style={{ display: "grid", gridTemplateColumns: `repeat(${remindOptions.length}, minmax(0, 1fr))`, gap: 6, background: t.raised, padding: 4, borderRadius: 14 }}>
                  {remindOptions.map((r) => (
                    <button
                      key={r.days}
                      role="radio"
                      aria-checked={remindDays === r.days}
                      onClick={() => setRemindDays(r.days)}
                      style={{ minHeight: 40, borderRadius: 10, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: remindDays === r.days ? t.sheet : "transparent", color: remindDays === r.days ? t.text : t.muted, boxShadow: remindDays === r.days ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
              <button onClick={save} disabled={saving || !form.name.trim()} style={primaryBtn(!saving && !!form.name.trim())}>
                {saving ? "Saving…" : "Save contact"}
              </button>
              <button onClick={() => setStep("talk")} style={secondaryBtn}>
                Back
              </button>
            </div>
          </>
        )}

        {step === "saved" && saved && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "16px 0 4px" }}>
            <SuccessCheck size={72} />
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 16 }}>{saved.name} is saved</div>
            <div style={{ fontSize: 15, color: t.muted, marginTop: 6 }}>
              {saved.remindOn ? `We'll remind you on ${new Date(saved.remindOn + "T09:00:00").toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}.` : "No reminder set."}
            </div>
            {draft && (
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(`${draft.subject}\n\n${draft.body}`);
                  showToast("Follow-up email copied.", "success");
                }}
                style={{ marginTop: 16, border: "none", background: "none", color: isDark ? "#C4B5FD" : "#7C3AED", fontSize: 15, fontWeight: 600, cursor: "pointer", minHeight: 40, display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <I.Mail size={16} /> Copy a follow-up email
              </button>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", marginTop: 20 }}>
              <button onClick={close} style={primaryBtn(true)}>
                Done
              </button>
              <button onClick={reset} style={secondaryBtn}>
                Record another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
