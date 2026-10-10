// Follow-up autopilot in the People screen: a one-tap "turn on" card on home, and a small control
// in each contact (pause / resume / they replied). Sending happens on the server.
import React, { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { I } from "../ui/icons";

const when = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

type Person = { id: string; name: string; email?: string | null; autopilotStatus?: string; autopilotStep?: number; autopilotNextAt?: string | null };

export function AutopilotCard({
  supabase,
  userId,
  isDark,
  people,
  showToast,
  onOpenSettings,
}: {
  supabase: SupabaseClient;
  userId: string;
  isDark: boolean;
  people: Person[];
  showToast: (m: string, t?: "success" | "error" | "info") => void;
  onOpenSettings: () => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    supabase.from("profiles").select("autopilot_enabled").eq("id", userId).maybeSingle().then(({ data, error }) => alive && setEnabled(error ? null : !!data?.autopilot_enabled));
    return () => {
      alive = false;
    };
  }, [supabase, userId]);
  if (enabled === null) return null; // not loaded, or the database isn't updated yet

  const surface = isDark ? "#1C1C1E" : "#FFFFFF";
  const border = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const muted = isDark ? "#AEAEB2" : "#6E6E73";
  const text = isDark ? "#FFFFFF" : "#1C1C1E";

  const turnOn = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("set_autopilot", { p_enabled: true });
    setBusy(false);
    if (error) return showToast("Couldn't turn it on. Please try again.", "error");
    setEnabled(true);
    showToast("Autopilot is on. Your follow-ups will go out on Day 1, 7 and 30.", "success");
  };

  if (!enabled) {
    return (
      <section aria-labelledby="ap-card" style={{ background: isDark ? "rgba(124,58,237,0.14)" : "#F5F0FF", border: `1px solid ${isDark ? "rgba(167,139,250,0.25)" : "#E4D8FF"}`, borderRadius: 20, padding: 18, margin: "0 0 20px", display: "flex", gap: 14, alignItems: "flex-start" }}>
        <span aria-hidden style={{ width: 44, height: 44, borderRadius: 14, background: "#7C3AED", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <I.Zap size={22} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id="ap-card" style={{ margin: 0, fontSize: 18, color: text }}>Put your follow-ups on autopilot</h2>
          <p style={{ margin: "4px 0 12px", fontSize: 15, color: muted, lineHeight: 1.45 }}>NetworQ writes and sends a personal follow-up on Day 1, 7 and 30 after you meet someone. You don't lift a finger.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={turnOn} disabled={busy} style={{ minHeight: 44, padding: "0 18px", borderRadius: 12, border: "none", background: "#7C3AED", color: "#FFF", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
              {busy ? "Turning on…" : "Turn on"}
            </button>
            <button onClick={onOpenSettings} style={{ minHeight: 44, padding: "0 14px", borderRadius: 12, border: "none", background: "transparent", color: "#7C3AED", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
              See how it works
            </button>
          </div>
        </div>
      </section>
    );
  }

  const weekEnd = Date.now() + 7 * 864e5;
  const upcoming = people.filter((p) => p.email && p.autopilotStatus === "active" && p.autopilotNextAt).sort((a, b) => String(a.autopilotNextAt).localeCompare(String(b.autopilotNextAt)));
  const thisWeek = upcoming.filter((p) => new Date(String(p.autopilotNextAt)).getTime() <= weekEnd).length;
  const next = upcoming[0];
  return (
    <button onClick={onOpenSettings} aria-label="Follow-up autopilot settings" style={{ all: "unset", boxSizing: "border-box", width: "100%", display: "flex", alignItems: "center", gap: 12, background: surface, border: `1px solid ${border}`, borderRadius: 16, padding: "12px 16px", margin: "0 0 20px", cursor: "pointer" }}>
      <span aria-hidden style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(52,199,89,0.15)", color: "#1F8A3B", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <I.Zap size={18} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: text }}>Autopilot is on</span>
        <span style={{ display: "block", fontSize: 13, color: muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {next ? `${thisWeek} follow-up${thisWeek === 1 ? "" : "s"} this week · next: ${next.name.split(" ")[0]}, ${when(next.autopilotNextAt)}` : "Add a contact with an email and their follow-ups are planned for you"}
        </span>
      </span>
      <span aria-hidden style={{ color: muted, display: "flex" }}>
        <I.ChevronLeft size={18} style={{ transform: "rotate(180deg)" }} />
      </span>
    </button>
  );
}

export function ContactAutopilot({
  supabase,
  person,
  isDark,
  onChanged,
  showToast,
}: {
  supabase: SupabaseClient;
  person: Person;
  isDark: boolean;
  onChanged: (patch: Partial<Person>) => void;
  showToast: (m: string, t?: "success" | "error" | "info") => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!person.autopilotStatus) return null; // database not updated yet
  const muted = isDark ? "#AEAEB2" : "#6E6E73";
  const status = person.autopilotStatus;
  const step = person.autopilotStep || 0;

  const set = async (s: "active" | "paused" | "replied", msg: string) => {
    setBusy(true);
    const { data, error } = await supabase.rpc("set_contact_autopilot", { p_contact: person.id, p_status: s });
    setBusy(false);
    if (error) return showToast("Couldn't update. Please try again.", "error");
    onChanged({ autopilotStatus: data.status, autopilotNextAt: data.next_at });
    showToast(msg, "success");
  };

  const line = !person.email
    ? "Autopilot needs an email address for this person."
    : status === "active"
      ? `Next follow-up ${when(person.autopilotNextAt)}${step ? ` · ${step} sent` : ""}`
      : status === "paused"
        ? "Follow-ups paused for this person."
        : status === "replied"
          ? "They replied — follow-ups stopped."
          : status === "done"
            ? `All ${step} follow-ups sent.`
            : "They unsubscribed — no more follow-ups.";

  const small: React.CSSProperties = { minHeight: 36, padding: "0 12px", borderRadius: 10, border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"}`, background: "transparent", color: isDark ? "#FFF" : "#1C1C1E", fontSize: 14, fontWeight: 600, cursor: "pointer" };
  return (
    <div role="group" aria-label="Follow-up autopilot for this person" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", borderRadius: 14, background: isDark ? "rgba(255,255,255,0.05)" : "#F6F6F8", marginBottom: 14 }}>
      <I.Zap size={16} color={status === "active" && person.email ? "#7C3AED" : muted} />
      <span style={{ flex: "1 1 160px", fontSize: 14, color: muted }}>{line}</span>
      {person.email && status === "active" && (
        <>
          <button style={small} disabled={busy} onClick={() => set("replied", "Marked as replied. No more follow-ups to this person.")}>They replied</button>
          <button style={small} disabled={busy} onClick={() => set("paused", "Follow-ups paused for this person.")}>Pause</button>
        </>
      )}
      {person.email && (status === "paused" || status === "replied") && (
        <button style={small} disabled={busy} onClick={() => set("active", "Follow-ups resumed.")}>Resume</button>
      )}
    </div>
  );
}
