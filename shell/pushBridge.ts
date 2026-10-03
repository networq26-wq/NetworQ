// Android shell side of push notifications (expo-notifications → Expo push → FCM).
//   web → native  { type: "push:register", prompt }   ask for permission (if prompt) and a token
//   native → web  { type: "push:token", token, permission }
// Tapping a notification opens its deep link (data.url) in the WebView, also from a cold start.
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { WebView } from "react-native-webview";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";

// While the app is open the web app shows its own toast + bell badge, so no system banner
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export const PUSH_CAPABILITY_JS = `window.__NETWORQ_SHELL__ = Object.assign(window.__NETWORQ_SHELL__ || {}, { push: true }); true;`;

export function usePushBridge(webViewRef: React.RefObject<React.ElementRef<typeof WebView> | null>, allowedOrigin: string) {
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const loaded = useRef(false);

  const send = useCallback(
    (detail: unknown) => {
      webViewRef.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent("networq-native",{detail:${JSON.stringify(detail)}}));true;`);
    },
    [webViewRef]
  );

  const open = useCallback(
    (url: unknown) => {
      if (typeof url !== "string" || !url.startsWith(allowedOrigin)) return;
      if (!loaded.current) return setStartUrl(url);
      webViewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`);
    },
    [allowedOrigin, webViewRef]
  );

  useEffect(() => {
    if (Platform.OS === "android") {
      Notifications.setNotificationChannelAsync("default", {
        name: "Requests & reminders",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 120, 200],
        lightColor: "#7C3AED",
      }).catch(() => {});
    }
    // Cold start from a notification tap
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification.request.content.data?.url);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data?.url));
    return () => sub.remove();
  }, [open]);

  const onMessage = useCallback(
    async (e: { nativeEvent: { data: string; url: string } }) => {
      if (!e.nativeEvent.url.startsWith(allowedOrigin)) return;
      let msg: any;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg?.type !== "push:register") return;
      try {
        let { status } = await Notifications.getPermissionsAsync();
        if (status !== "granted" && msg.prompt) status = (await Notifications.requestPermissionsAsync()).status;
        if (status !== "granted") return send({ type: "push:token", token: null, permission: status });
        const projectId = (Constants as any).easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
        const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
        send({ type: "push:token", token: data, permission: "granted" });
      } catch (err: any) {
        send({ type: "push:token", token: null, permission: "error", message: String(err?.message || err) });
      }
    },
    [allowedOrigin, send]
  );

  return { onMessage, startUrl, onLoadEnd: () => (loaded.current = true) };
}
