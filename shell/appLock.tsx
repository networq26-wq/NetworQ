// App lock (Android shell): fingerprint / face, with the phone's own PIN, pattern or password as the
// passcode — like Google's apps. Settings live in Android's encrypted storage. When locked, a NetworQ
// lock screen covers the app until the owner unlocks.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import type { WebView, WebViewMessageEvent } from "react-native-webview";

const KEY = "networq.applock";
const NATIVE_EVENT = "networq-native";
type Settings = { enabled: boolean; timeoutMs: number };
const DEFAULTS: Settings = { enabled: false, timeoutMs: 60_000 };

export const APPLOCK_CAPABILITY_JS = `window.__NETWORQ_SHELL__ = Object.assign(window.__NETWORQ_SHELL__ || {}, { appLock: true }); true;`;

async function readSettings(): Promise<Settings> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

async function capability() {
  const hardware = await LocalAuthentication.hasHardwareAsync().catch(() => false);
  const level = await LocalAuthentication.getEnrolledLevelAsync().catch(() => LocalAuthentication.SecurityLevel.NONE);
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync().catch(() => [] as LocalAuthentication.AuthenticationType[]);
  return {
    // Usable when the phone has a fingerprint/face OR at least a screen-lock PIN/pattern/password
    supported: level !== LocalAuthentication.SecurityLevel.NONE,
    biometric: hardware && (level === LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK || level === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG),
    fingerprint: types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT),
    face: types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION),
  };
}

function authenticate(promptMessage: string) {
  return LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: "Cancel",
    disableDeviceFallback: false, // allow the phone's PIN / pattern / password as the passcode
    requireConfirmation: false,
  });
}

export function useAppLock(webViewRef: React.RefObject<React.ElementRef<typeof WebView> | null>, allowedOrigin: string) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const backgroundAt = useRef<number | null>(null);
  const settingsRef = useRef<Settings>(DEFAULTS);

  const send = useCallback(
    (detail: unknown) => webViewRef.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent(${JSON.stringify(NATIVE_EVENT)},{detail:${JSON.stringify(detail)}}));true;`),
    [webViewRef]
  );

  const unlock = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await authenticate("Unlock NetworQ");
      if (r.success) setLocked(false);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // On start: lock if enabled
  useEffect(() => {
    readSettings().then((s) => {
      settingsRef.current = s;
      setSettings(s);
      if (s.enabled) setLocked(true);
    });
  }, []);

  // Ask for the fingerprint as soon as the lock screen appears
  useEffect(() => {
    if (locked) {
      const t = setTimeout(() => unlock(), 350);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  // Lock again after being in the background longer than the chosen time
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      const s = settingsRef.current;
      if (state === "background" || state === "inactive") {
        if (backgroundAt.current === null) backgroundAt.current = Date.now();
      } else if (state === "active") {
        const away = backgroundAt.current === null ? 0 : Date.now() - backgroundAt.current;
        backgroundAt.current = null;
        if (s.enabled && away >= s.timeoutMs) setLocked(true);
      }
    });
    return () => sub.remove();
  }, []);

  // Settings page ↔ shell
  const onMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*networq\.co\.in(\/|$)/i.test(event.nativeEvent.url) && !event.nativeEvent.url.startsWith(allowedOrigin)) return;
      let msg: any;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (msg?.type === "lock:get") {
        send({ type: "lock:state", ...(await capability()), ...settingsRef.current });
      } else if (msg?.type === "lock:set") {
        const next: Settings = {
          enabled: !!msg.enabled,
          timeoutMs: [0, 60_000, 300_000].includes(Number(msg.timeoutMs)) ? Number(msg.timeoutMs) : settingsRef.current.timeoutMs,
        };
        const cap = await capability();
        if (next.enabled && !cap.supported) {
          return send({ type: "lock:error", message: "Set up a fingerprint or a screen lock (PIN, pattern or password) in your phone's settings first." });
        }
        // Turning the lock on or off always needs the owner's fingerprint / passcode
        if (next.enabled !== settingsRef.current.enabled) {
          const r = await authenticate(next.enabled ? "Confirm it's you to turn on App lock" : "Confirm it's you to turn off App lock");
          if (!r.success) return send({ type: "lock:error", message: "App lock wasn't changed." });
        }
        await SecureStore.setItemAsync(KEY, JSON.stringify(next));
        settingsRef.current = next;
        setSettings(next);
        send({ type: "lock:state", ...cap, ...next });
      }
    },
    [allowedOrigin, send]
  );

  const overlay = locked ? (
    <View style={styles.cover} accessibilityViewIsModal accessibilityLabel="NetworQ is locked">
      <Image source={require("../assets/icon.png")} style={styles.logo} />
      <Text style={styles.title}>NetworQ is locked</Text>
      <Text style={styles.body}>Use your fingerprint or your phone's PIN to unlock.</Text>
      <Pressable onPress={unlock} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.button, (pressed || busy) && { opacity: 0.8 }]}>
        <Text style={styles.buttonText}>{busy ? "Waiting…" : "Unlock"}</Text>
      </Pressable>
    </View>
  ) : null;

  return { onMessage, overlay, locked, ready: settings !== null };
}

const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFillObject, zIndex: 1000, backgroundColor: "#0B0F19", alignItems: "center", justifyContent: "center", padding: 32 },
  logo: { width: 88, height: 88, borderRadius: 22, marginBottom: 24 },
  title: { color: "#FFFFFF", fontSize: 24, fontWeight: "700", marginBottom: 8 },
  body: { color: "rgba(255,255,255,0.7)", fontSize: 16, textAlign: "center", lineHeight: 22, marginBottom: 32 },
  button: { backgroundColor: "#7C3AED", borderRadius: 16, paddingVertical: 16, paddingHorizontal: 48, minWidth: 220, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
});
