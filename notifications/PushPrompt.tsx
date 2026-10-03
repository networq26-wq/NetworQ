// One-time card in the notification centre: "Get notified on this phone / in this browser".
import React, { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enablePush, pushStatus } from "./pushClient";

const DISMISS_KEY = "networq.push.promptDismissed";

export function PushPrompt({ supabase, apiBase, isDark, showToast }: { supabase: SupabaseClient; apiBase: string; isDark: boolean; showToast: (m: string, t?: "success" | "error" | "info") => void }) {
  const [status, setStatus] = useState(pushStatus());
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (status !== "off" || dismissed) return null;
  const inApp = typeof window !== "undefined" && !!(window as any).ReactNativeWebView;

  return (
    <div role="region" aria-label="Turn on notifications" style={{ margin: "0 0 12px", padding: 14, borderRadius: 14, background: isDark ? "rgba(167,139,250,0.14)" : "rgba(124,58,237,0.08)" }}>
      <div style={{ fontWeight: 600, fontSize: 15 }}>Get notified {inApp ? "on this phone" : "in this browser"}</div>
      <div style={{ fontSize: 13, opacity: 0.75, margin: "4px 0 10px", lineHeight: 1.4 }}>Know the moment someone wants to connect, accepts your request, or a follow-up is due — even when NetworQ is closed.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const s = await enablePush(supabase, apiBase, true);
              setStatus(s);
              if (s === "on") showToast("Notifications are on.", "success");
              else if (s === "denied") showToast("Notifications are blocked. Turn them on in your phone or browser settings.", "info");
            } catch (e: any) {
              showToast(e.message, "error");
            } finally {
              setBusy(false);
            }
          }}
          style={{ minHeight: 36, padding: "6px 14px", borderRadius: 10, border: "none", background: "#7C3AED", color: "#FFF", fontWeight: 600, cursor: "pointer" }}
        >
          {busy ? "Turning on…" : "Turn on"}
        </button>
        <button
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, "1");
            } catch {}
            setDismissed(true);
          }}
          style={{ minHeight: 36, padding: "6px 12px", borderRadius: 10, border: "none", background: "transparent", color: "inherit", opacity: 0.7, cursor: "pointer" }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
