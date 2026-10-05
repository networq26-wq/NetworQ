// Settings sections: blocked people, recent devices, help & support, about.
import React, { useEffect, useState } from "react";
import { Skeleton } from "../ui/icons";
import type { SupabaseClient } from "@supabase/supabase-js";
import { disablePush, enablePush, pushStatus, type PushStatus } from "../notifications/pushClient";

type Theme = { surface: string; raised: string; text: string; muted: string; border: string };
export const SUPPORT_EMAIL = "support@networq.co.in";
export const APP_VERSION = "1.0.0";

const rowStyle = (t: Theme): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: `1px solid ${t.border}` });

// ── Blocked people ────────────────────────────────────────────────────────────
export function BlockedUsers({ supabase, t, card, showToast }: { supabase: SupabaseClient; t: Theme; card: React.CSSProperties; showToast: (m: string, k?: "success" | "error" | "info") => void }) {
  const [rows, setRows] = useState<{ user_id: string; name: string; blocked_at: string }[] | null>(null);
  useEffect(() => {
    supabase.rpc("my_blocked_users").then(({ data }) => setRows((data as any[]) || []));
  }, [supabase]);

  const unblock = async (id: string, name: string) => {
    const { error } = await supabase.rpc("unblock_user", { p_user: id });
    if (error) return showToast("Couldn't unblock. Please try again.", "error");
    setRows((r) => (r || []).filter((x) => x.user_id !== id));
    showToast(`${name} unblocked.`, "success");
  };

  return (
    <section style={card} aria-labelledby="settings-blocked">
      <h3 id="settings-blocked" style={{ margin: "0 0 4px", fontSize: 18 }}>Blocked people</h3>
      <div style={{ color: t.muted, fontSize: 13, marginBottom: 6 }}>Blocked people can't see you on Radar or send you requests, and you won't see them.</div>
      {rows === null ? (
        <div role="status" aria-label="Loading blocked people" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 0" }}>
          <Skeleton w="60%" h={14} />
          <Skeleton w="40%" h={11} />
        </div>
      ) : rows.length === 0 ? (
        <div style={{ color: t.muted, fontSize: 14, padding: "10px 0" }}>You haven't blocked anyone.</div>
      ) : (
        <ul aria-label="Blocked people" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <li key={r.user_id} style={rowStyle(t)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div style={{ color: t.muted, fontSize: 12 }}>Blocked {new Date(r.blocked_at).toLocaleDateString([], { dateStyle: "medium" })}</div>
              </div>
              <button onClick={() => unblock(r.user_id, r.name)} aria-label={`Unblock ${r.name}`} style={{ minHeight: 36, padding: "6px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.raised, color: t.text, fontWeight: 600, cursor: "pointer" }}>
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Recent devices ────────────────────────────────────────────────────────────
export function deviceLabel(ua: string | null): string {
  const s = ua || "";
  const os = /NetworQ|; wv\)/.test(s) && /Android/.test(s) ? "NetworQ Android app" : /Android/.test(s) ? "Android" : /iPhone|iPad/.test(s) ? "iPhone" : /Mac OS X/.test(s) ? "Mac" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "Unknown device";
  if (os === "NetworQ Android app") return os;
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox" : /CriOS|Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}

export function RecentDevices({ supabase, t, onSignOutEverywhere, btn }: { supabase: SupabaseClient; t: Theme; onSignOutEverywhere: () => void; btn: React.CSSProperties }) {
  const [rows, setRows] = useState<{ device_hash: string; user_agent: string | null; first_seen: string; last_seen: string }[] | null>(null);
  useEffect(() => {
    supabase
      .from("login_devices")
      .select("device_hash, user_agent, first_seen, last_seen")
      .order("last_seen", { ascending: false })
      .limit(10)
      .then(({ data }) => setRows((data as any[]) || []));
  }, [supabase]);
  return (
    <>
      <h4 style={{ margin: "22px 0 6px", fontSize: 15 }}>Devices</h4>
      <div style={{ color: t.muted, fontSize: 13, marginBottom: 6 }}>Where your account has signed in recently. Don't recognise one? Sign out everywhere and change your password.</div>
      {rows && rows.length > 0 && (
        <ul aria-label="Recent devices" style={{ listStyle: "none", margin: "0 0 10px", padding: 0 }}>
          {rows.map((d) => (
            <li key={d.device_hash} style={rowStyle(t)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{deviceLabel(d.user_agent)}</div>
                <div style={{ color: t.muted, fontSize: 12 }}>
                  Last active {new Date(d.last_seen).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · first seen {new Date(d.first_seen).toLocaleDateString([], { dateStyle: "medium" })}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button style={btn} onClick={onSignOutEverywhere}>
        Sign out of all devices
      </button>
    </>
  );
}

// ── Help & about ──────────────────────────────────────────────────────────────
export function HelpAbout({ t, card, btn, userEmail, apiBaseUrl = "" }: { t: Theme; card: React.CSSProperties; btn: React.CSSProperties; userEmail?: string; apiBaseUrl?: string }) {
  const [server, setServer] = useState<{ ok: boolean; version?: string } | null>(null);
  useEffect(() => {
    fetch(`${apiBaseUrl}/api/version`)
      .then((r) => r.json())
      .then((j) => setServer({ ok: true, version: j.version }))
      .catch(() => setServer({ ok: false }));
  }, [apiBaseUrl]);
  const shell = typeof window !== "undefined" && (window as any).ReactNativeWebView ? "Android app" : "Web";
  const diag = `\n\n---\nNetworQ ${APP_VERSION} (${shell})\n${typeof navigator !== "undefined" ? navigator.userAgent : ""}\nAccount: ${userEmail || ""}`;
  const link = (href: string, text: string, ext = false) => (
    <a href={href} {...(ext ? { target: "_blank", rel: "noopener" } : {})} style={{ ...btn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
      {text}
    </a>
  );
  return (
    <section style={card} aria-labelledby="settings-help">
      <h3 id="settings-help" style={{ margin: "0 0 12px", fontSize: 18 }}>Help & support</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {link(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("NetworQ help")}&body=${encodeURIComponent(diag)}`, "Contact support")}
        {link(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Problem report")}&body=${encodeURIComponent("What happened?\n\nWhat did you expect?\n" + diag)}`, "Report a problem")}
        {link("/privacy", "Privacy policy", true)}
        {link("/terms", "Terms", true)}
        {link("/bot", "About our event crawler", true)}
      </div>
      <div style={{ ...rowStyle(t), marginTop: 16 }}>
        <div style={{ flex: 1, color: t.muted, fontSize: 14 }}>Version</div>
        <div style={{ fontSize: 14, fontWeight: 600 }} aria-label="App version">
          {APP_VERSION} · {shell}
        </div>
      </div>
      <div style={rowStyle(t)}>
        <div style={{ flex: 1, color: t.muted, fontSize: 14 }}>Server</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: server ? (server.ok ? "#34C759" : "#FF3B30") : t.muted }}>{server ? (server.ok ? `Online · ${server.version}` : "Unreachable") : "Checking…"}</div>
      </div>
    </section>
  );
}

// ── Push on this device ──────────────────────────────────────────────────────
export function PushSwitch({ supabase, t, apiBaseUrl = "", showToast }: { supabase: SupabaseClient; t: Theme; apiBaseUrl?: string; showToast: (m: string, k?: "success" | "error" | "info") => void }) {
  const [status, setStatus] = useState<PushStatus>(pushStatus());
  const [busy, setBusy] = useState(false);
  const on = status === "on";
  const hint =
    status === "unsupported"
      ? "This browser can't receive notifications. Use the NetworQ Android app or Chrome."
      : status === "denied"
        ? "Blocked in your phone or browser settings — allow notifications for NetworQ there."
        : "Requests, accepts and follow-up reminders on this device, even when NetworQ is closed.";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>Push notifications</div>
        <div style={{ color: t.muted, fontSize: 13 }}>{hint}</div>
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label="Push notifications"
        disabled={busy || status === "unsupported"}
        onClick={async () => {
          setBusy(true);
          try {
            if (on) {
              await disablePush(supabase);
              setStatus("off");
            } else {
              const s = await enablePush(supabase, apiBaseUrl, true);
              setStatus(s);
              if (s === "denied") showToast("Notifications are blocked. Allow them in your phone or browser settings.", "info");
            }
          } catch (e: any) {
            showToast(e.message, "error");
          } finally {
            setBusy(false);
          }
        }}
        style={{ width: 52, minWidth: 52, height: 32, borderRadius: 16, border: "none", padding: 2, cursor: "pointer", opacity: status === "unsupported" ? 0.45 : 1, background: on ? "#7C3AED" : t.raised, boxShadow: `inset 0 0 0 1px ${t.border}` }}
      >
        <span style={{ display: "block", width: 28, height: 28, borderRadius: 14, background: "#FFFFFF", transform: `translateX(${on ? 20 : 0}px)`, transition: "transform 0.2s" }} />
      </button>
    </div>
  );
}

// App lock (Android app only): fingerprint / face, with the phone's PIN, pattern or password as the passcode.
type LockState = { supported: boolean; biometric: boolean; fingerprint: boolean; face: boolean; enabled: boolean; timeoutMs: number };
export function AppLockSetting({ t, showToast }: { t: Theme; showToast: (m: string, k?: "success" | "error" | "info") => void }) {
  const shell = typeof window !== "undefined" ? (window as any) : null;
  const available = !!shell?.__NETWORQ_SHELL__?.appLock && !!shell?.ReactNativeWebView;
  const [state, setState] = useState<LockState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!available) return;
    const onNative = (e: any) => {
      const m = e.detail;
      if (m?.type === "lock:state") {
        setState(m);
        setBusy(false);
      } else if (m?.type === "lock:error") {
        setBusy(false);
        showToast(m.message, "info");
      }
    };
    window.addEventListener("networq-native", onNative);
    shell.ReactNativeWebView.postMessage(JSON.stringify({ type: "lock:get" }));
    return () => window.removeEventListener("networq-native", onNative);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  if (!available) return null; // websites can't use the phone's fingerprint this way
  const set = (patch: Partial<LockState>) => {
    if (!state) return;
    setBusy(true);
    shell.ReactNativeWebView.postMessage(JSON.stringify({ type: "lock:set", enabled: patch.enabled ?? state.enabled, timeoutMs: patch.timeoutMs ?? state.timeoutMs }));
  };
  const how = state?.fingerprint ? "Fingerprint or phone PIN" : state?.face ? "Face unlock or phone PIN" : "Your phone's PIN, pattern or password";
  const on = !!state?.enabled;
  return (
    <div style={{ padding: "10px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>App lock</div>
          <div style={{ color: t.muted, fontSize: 13 }}>
            {state && !state.supported ? "Set up a fingerprint or a screen lock in your phone's settings to use App lock." : `${how} to open NetworQ.`}
          </div>
        </div>
        <button
          role="switch"
          aria-checked={on}
          aria-label="App lock"
          disabled={busy || !state || !state.supported}
          onClick={() => set({ enabled: !on })}
          style={{ width: 52, minWidth: 52, height: 32, borderRadius: 16, border: "none", padding: 2, cursor: "pointer", opacity: !state || !state.supported ? 0.45 : 1, background: on ? "#7C3AED" : t.raised, boxShadow: `inset 0 0 0 1px ${t.border}` }}
        >
          <span style={{ display: "block", width: 28, height: 28, borderRadius: 14, background: "#FFFFFF", transform: `translateX(${on ? 20 : 0}px)`, transition: "transform 0.2s" }} />
        </button>
      </div>
      {on && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: t.muted, marginBottom: 6 }}>Lock after</div>
          <div role="radiogroup" aria-label="Lock after" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4, background: t.raised, padding: 3, borderRadius: 12 }}>
            {[
              { ms: 0, label: "Immediately" },
              { ms: 60_000, label: "1 minute" },
              { ms: 300_000, label: "5 minutes" },
            ].map((o) => {
              const sel = state?.timeoutMs === o.ms;
              return (
                <button key={o.ms} role="radio" aria-checked={sel} disabled={busy} onClick={() => set({ timeoutMs: o.ms })} style={{ minHeight: 38, borderRadius: 9, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: sel ? t.surface : "transparent", color: sel ? t.text : t.muted, boxShadow: sel ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
