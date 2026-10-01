// Native-shell side of the Event Radar bridge (App.native.tsx only).
// Owns Android permissions, app lifecycle and the BLE module; relays validated
// messages between the module and the NetworQ web app inside the WebView.
import { useCallback, useEffect, useRef } from "react";
import { AppState, Linking, PermissionsAndroid, Platform } from "react-native";
import type { WebView, WebViewMessageEvent } from "react-native-webview";
import NetworqRadar from "../modules/networq-radar";
import { NATIVE_EVENT, isWebToNative, type NativeToWeb, type PermissionState } from "./protocol";

function requiredPermissions() {
  const P = PermissionsAndroid.PERMISSIONS;
  return Number(Platform.Version) >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_ADVERTISE] : [P.ACCESS_FINE_LOCATION];
}

async function checkPermission(): Promise<PermissionState> {
  if (Platform.OS !== "android") return "denied";
  const results = await Promise.all(requiredPermissions().map((p) => PermissionsAndroid.check(p)));
  return results.every(Boolean) ? "granted" : "denied";
}

async function requestPermission(): Promise<PermissionState> {
  if (Platform.OS !== "android") return "denied";
  const res = await PermissionsAndroid.requestMultiple(requiredPermissions());
  const values = Object.values(res);
  if (values.every((v) => v === PermissionsAndroid.RESULTS.GRANTED)) return "granted";
  return values.some((v) => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) ? "blocked" : "denied";
}

export function useRadarBridge(webViewRef: React.RefObject<React.ElementRef<typeof WebView> | null>, allowedOrigin: string) {
  const wanted = useRef(false);
  const token = useRef<string | null>(null);
  const permission = useRef<PermissionState>("denied");

  const send = useCallback(
    (msg: NativeToWeb) => {
      const js = `window.dispatchEvent(new CustomEvent(${JSON.stringify(NATIVE_EVENT)},{detail:${JSON.stringify(msg)}}));true;`;
      webViewRef.current?.injectJavaScript(js);
    },
    [webViewRef]
  );

  const sendCapabilities = useCallback(() => {
    send({ type: "radar:capabilities", state: NetworqRadar ? NetworqRadar.getState() : "unsupported", permission: permission.current });
  }, [send]);

  // Module events → web
  useEffect(() => {
    if (!NetworqRadar) return;
    const subs = [
      NetworqRadar.addListener("onSightings", (e) => send({ type: "radar:sightings", items: e.items })),
      NetworqRadar.addListener("onStateChange", (e) => {
        send({ type: "radar:state", state: e.state });
        if (e.state === "on" && wanted.current) NetworqRadar?.start(token.current);
      }),
      NetworqRadar.addListener("onError", (e) => send({ type: "radar:error", code: e.code, message: e.message })),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [send]);

  // Pause in background (Android restricts background BLE); resume on return
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (!NetworqRadar) return;
      if (s === "active" && wanted.current) {
        send({ type: "radar:state", state: NetworqRadar.start(token.current) });
      } else if (s !== "active") {
        NetworqRadar.stop();
      }
    });
    return () => {
      sub.remove();
      NetworqRadar?.stop();
    };
  }, [send]);

  const onMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      if (!event.nativeEvent.url.startsWith(allowedOrigin)) return;
      let msg: unknown;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (!isWebToNative(msg)) return;

      switch (msg.type) {
        case "radar:capabilities":
          permission.current = await checkPermission();
          sendCapabilities();
          break;
        case "radar:start": {
          token.current = msg.token;
          wanted.current = true;
          if (!NetworqRadar) return sendCapabilities();
          permission.current = await checkPermission();
          if (permission.current !== "granted") permission.current = await requestPermission();
          if (permission.current !== "granted") return sendCapabilities();
          send({ type: "radar:state", state: NetworqRadar.start(msg.token) });
          break;
        }
        case "radar:token":
          token.current = msg.token;
          NetworqRadar?.setToken(msg.token);
          break;
        case "radar:stop":
          wanted.current = false;
          NetworqRadar?.stop();
          break;
        case "radar:openSettings":
          if (permission.current === "blocked") Linking.openSettings();
          else NetworqRadar?.openBluetoothSettings();
          break;
      }
    },
    [allowedOrigin, send, sendCapabilities]
  );

  return { onMessage };
}
