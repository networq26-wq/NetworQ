// Turns push notifications on/off for THIS device.
//   • Android app: asks the native shell (expo-notifications) for an Expo push token.
//   • Browsers: Web Push via the service worker at /sw.js and the server's VAPID key.
// The token is stored server-side with register_push_token; it moves to whoever signs in.
import type { SupabaseClient } from "@supabase/supabase-js";

const DEVICE_KEY = "networq.push.token";
export type PushStatus = "on" | "off" | "denied" | "unsupported";

const isShell = () => typeof window !== "undefined" && !!(window as any).ReactNativeWebView && !!(window as any).__NETWORQ_SHELL__?.push;
const webSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined" && !(window as any).ReactNativeWebView;

function stored(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}
function store(token: string | null) {
  try {
    if (token) localStorage.setItem(DEVICE_KEY, token);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {}
}

export function pushSupported(): boolean {
  return isShell() || webSupported();
}

export function pushStatus(): PushStatus {
  if (!pushSupported()) return "unsupported";
  if (webSupported() && Notification.permission === "denied") return "denied";
  return stored() ? "on" : "off";
}

// Ask the Android shell for a token. prompt=false never shows the system dialog.
function shellToken(prompt: boolean): Promise<{ token: string | null; permission: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("networq-native", onMsg as EventListener);
      resolve({ token: null, permission: "timeout" });
    }, 60_000);
    function onMsg(e: CustomEvent) {
      if (e.detail?.type !== "push:token") return;
      clearTimeout(timer);
      window.removeEventListener("networq-native", onMsg as EventListener);
      resolve({ token: e.detail.token || null, permission: e.detail.permission || "granted" });
    }
    window.addEventListener("networq-native", onMsg as EventListener);
    (window as any).ReactNativeWebView.postMessage(JSON.stringify({ type: "push:register", prompt }));
  });
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function webSubscription(apiBase: string, prompt: boolean): Promise<PushSubscription | null> {
  if (Notification.permission !== "granted") {
    if (!prompt) return null;
    if ((await Notification.requestPermission()) !== "granted") return null;
  }
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  const cfg = await fetch(`${apiBase}/api/push/config`).then((r) => r.json());
  if (!cfg.vapidPublicKey) throw new Error("Browser notifications aren't set up on the server yet.");
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey) });
}

// Returns the new status. prompt=false is used on sign-in to silently re-attach a device
// the user already enabled (no permission dialogs).
export async function enablePush(supabase: SupabaseClient, apiBase: string, prompt = true): Promise<PushStatus> {
  if (isShell()) {
    const { token, permission } = await shellToken(prompt);
    if (!token) return permission === "denied" ? "denied" : "off";
    const { error } = await supabase.rpc("register_push_token", { p_token: token, p_platform: "android" });
    if (error) throw new Error("Couldn't turn on notifications. Please try again.");
    store(token);
    return "on";
  }
  if (webSupported()) {
    const sub = await webSubscription(apiBase, prompt);
    if (!sub) return Notification.permission === "denied" ? "denied" : "off";
    const json = sub.toJSON();
    const { error } = await supabase.rpc("register_push_token", { p_token: json.endpoint, p_platform: "web", p_subscription: json });
    if (error) throw new Error("Couldn't turn on notifications. Please try again.");
    store(json.endpoint!);
    return "on";
  }
  return "unsupported";
}

// Turn off for this device (also used before signing out so the next person on this
// phone doesn't receive the previous person's notifications).
export async function disablePush(supabase: SupabaseClient, { keepPreference = false } = {}): Promise<void> {
  const token = stored();
  if (token) await supabase.rpc("unregister_push_token", { p_token: token }).then(() => {}, () => {});
  if (webSupported() && !keepPreference) {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
    } catch {}
  }
  if (!keepPreference) store(null);
}

// After sign-in: if this device had push on, attach it to the signed-in account silently
export async function reattachPush(supabase: SupabaseClient, apiBase: string): Promise<void> {
  if (!stored()) return;
  try {
    const s = await enablePush(supabase, apiBase, false);
    if (s !== "on") store(null);
  } catch {}
}

// Detach this device before ANY sign-out (header button, Settings, "sign out everywhere"),
// so the next person signing in on this phone never gets the previous person's notifications.
// The device preference is kept, so it re-attaches silently to whoever signs in next.
let hooked = false;
export function installSignOutHook(supabase: SupabaseClient) {
  if (hooked) return;
  hooked = true;
  const original = supabase.auth.signOut.bind(supabase.auth);
  (supabase.auth as any).signOut = async (options?: Parameters<typeof original>[0]) => {
    await disablePush(supabase, { keepPreference: true }).catch(() => {});
    return original(options);
  };
}
