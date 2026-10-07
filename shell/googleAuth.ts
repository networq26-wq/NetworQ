// Android shell: Google sign-in through the system browser, handed back to the web app.
import { useCallback } from "react";
import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";
import type { WebView, WebViewMessageEvent } from "react-native-webview";
import { supabaseUrl, supabaseAnonKey } from "../supabase";
import { AUTH_REDIRECT, buildAuthorizeUrl, exchangeCode, parseCallback, toBase64Url } from "./googleAuthCore";

const NATIVE_EVENT = "networq-native";

// Tells the web app this shell can do Google sign-in natively
export const SHELL_CAPABILITIES_JS = `window.__NETWORQ_SHELL__ = Object.assign(window.__NETWORQ_SHELL__ || {}, { googleAuth: true }); true;`;

async function pkcePair() {
  const bytes = Crypto.getRandomBytes(32);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const verifier = toBase64Url(btoa(bin));
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
  return { verifier, challenge: toBase64Url(digest) };
}

export function useGoogleAuthBridge(webViewRef: React.RefObject<React.ElementRef<typeof WebView> | null>, allowedOrigin: string) {
  const send = useCallback(
    (detail: unknown) => {
      webViewRef.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent(${JSON.stringify(NATIVE_EVENT)},{detail:${JSON.stringify(detail)}}));true;`);
    },
    [webViewRef]
  );

  const onMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      if (!event.nativeEvent.url.startsWith(allowedOrigin)) return;
      let msg: any;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (msg?.type !== "auth:google") return;
      try {
        // NetworQ's own sign-in page: Google shows "continue to networq.co.in" (not the Supabase address)
        const result = await WebBrowser.openAuthSessionAsync(`${allowedOrigin}/api/google/signin?from=app`, AUTH_REDIRECT);
        if (result.type !== "success") return send({ type: "auth:error", message: "Google sign-in was cancelled." });
        const q = new URLSearchParams(result.url.split("?")[1]?.split("#")[0] || "");
        const idToken = q.get("id_token");
        if (idToken) return send({ type: "auth:idtoken", idToken });
        if (q.get("error") && !q.get("fallback")) return send({ type: "auth:error", message: q.get("error") });
        // Fallback: the older Supabase PKCE flow
        const { verifier, challenge } = await pkcePair();
        const legacy = await WebBrowser.openAuthSessionAsync(buildAuthorizeUrl(supabaseUrl, challenge), AUTH_REDIRECT);
        if (legacy.type !== "success") return send({ type: "auth:error", message: "Google sign-in was cancelled." });
        const parsed = parseCallback(legacy.url);
        if ("error" in parsed) return send({ type: "auth:error", message: parsed.error });
        const session = await exchangeCode(supabaseUrl, supabaseAnonKey, parsed.code, verifier);
        send({ type: "auth:session", ...session });
      } catch (err: any) {
        send({ type: "auth:error", message: err?.message || "Google sign-in failed." });
      }
    },
    [allowedOrigin, send]
  );

  return { onMessage };
}
