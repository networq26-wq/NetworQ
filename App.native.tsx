import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  BackHandler,
  StatusBar,
  TouchableOpacity,
  Platform,
  Linking,
  KeyboardAvoidingView,
  ToastAndroid,
  PermissionsAndroid,
} from "react-native";
// react-native's SafeAreaView is iOS-only; with Android edge-to-edge the WebView
// would otherwise draw under the status bar and the gesture/navigation bar.
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useRadarBridge } from "./radar/shellBridge";
import { SHELL_CAPABILITIES_JS, useGoogleAuthBridge } from "./shell/googleAuth";
import { PUSH_CAPABILITY_JS, usePushBridge } from "./shell/pushBridge";
import { APPLOCK_CAPABILITY_JS, useAppLock } from "./shell/appLock";
import type { WebViewNavigation, WebViewHttpErrorEvent, ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";

const TARGET_URL = "https://www.networq.co.in";

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const webViewRef = useRef<React.ElementRef<typeof WebView>>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [hasError, setHasError] = useState(false);
  const insets = useSafeAreaInsets();
  const radarBridge = useRadarBridge(webViewRef, TARGET_URL);
  const googleAuth = useGoogleAuthBridge(webViewRef, TARGET_URL);
  const push = usePushBridge(webViewRef, TARGET_URL);
  const lock = useAppLock(webViewRef, TARGET_URL); // fingerprint / phone passcode app lock

  const safeAreaScript = `
    (function() {
      try {
        var s = document.getElementById('networq-native-safe-insets');
        if (!s) {
          s = document.createElement('style');
          s.id = 'networq-native-safe-insets';
          (document.head || document.documentElement).appendChild(s);
        }
        s.textContent = ':root { --safe-top: ${insets.top}px !important; --safe-bottom: ${insets.bottom}px !important; --safe-left: ${insets.left}px !important; --safe-right: ${insets.right}px !important; }';
      } catch(e) {}
    })();
    true;
  `;

  useEffect(() => {
    webViewRef.current?.injectJavaScript(safeAreaScript);
  }, [insets.top, insets.bottom, insets.left, insets.right]);

  // Hardware back: let the web app close overlays / go to the previous tab first;
  // on the home screen, a second press within 2 s exits.
  const lastBackAt = useRef(0);
  const backFallback = useRef<any>(null);
  const handleNavRef = useRef<(raw: string) => void>(() => {});
  const hasErrorRef = useRef(false);
  hasErrorRef.current = hasError;
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const onBackPress = () => {
      if (hasErrorRef.current) return false; // offline screen: let Android close the app
      // If the page doesn't answer (still loading, crashed), still go back — never exit on one press
      clearTimeout(backFallback.current);
      backFallback.current = setTimeout(() => handleNavRef.current(JSON.stringify({ type: "nav:back", handled: false })), 600);
      webViewRef.current?.injectJavaScript(
        `(function(){var h=false;try{h=!!(window.__networqHandleBack&&window.__networqHandleBack());}catch(e){}window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:"nav:back",handled:h}));})();true;`
      );
      return true;
    };
    const subscription = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => subscription.remove();
  }, []);

  const handleNavMessage = useCallback(
    (raw: string) => {
      let msg: any;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg?.type === "perm:camera") {
        if (Platform.OS === "android") PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA).catch(() => {});
        return;
      }
      // Calls and voice notes: ask Android for the microphone (and camera for video), then tell the page
      if (msg?.type === "perm:media") {
        const reply = (granted: boolean) =>
          webViewRef.current?.injectJavaScript(`window.__networqPermResult&&window.__networqPermResult(${JSON.stringify({ id: msg.id, granted })});true;`);
        if (Platform.OS !== "android") return reply(true);
        const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, ...(msg.video ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])];
        PermissionsAndroid.requestMultiple(wanted)
          .then((r) => reply(wanted.every((p) => r[p] === PermissionsAndroid.RESULTS.GRANTED)))
          .catch(() => reply(false));
        return;
      }
      if (msg?.type !== "nav:back") return;
      clearTimeout(backFallback.current);
      if (msg.handled) return;
      if (canGoBack) return webViewRef.current?.goBack(); // e.g. from /privacy back to the app
      const now = Date.now();
      if (now - lastBackAt.current < 2000) return BackHandler.exitApp();
      lastBackAt.current = now;
      ToastAndroid.show("Press back again to exit", ToastAndroid.SHORT);
    },
    [canGoBack]
  );

  handleNavRef.current = handleNavMessage;

  // mailto:, tel:, sms:, intent: etc. can't load inside the WebView — hand them to the OS
  const handleShouldStartLoad = useCallback((request: ShouldStartLoadRequest) => {
    if (/^(about|data|blob):/i.test(request.url)) return true;
    // Chat photos/files (Supabase Storage links) open in the phone's own viewer, which can show PDFs and save files
    if (request.isTopFrame && /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\//i.test(request.url)) {
      Linking.openURL(request.url).catch(() => {});
      return false;
    }
    // Only NetworQ itself (and Supabase auth redirects) load inside the app, which has camera/mic access.
    // Any other site — event pages, Google Calendar, Meet links — opens in the phone's browser/apps.
    if (/^https:\/\/(([a-z0-9-]+\.)*networq\.co\.in|[a-z0-9-]+\.supabase\.co)(\/|$|\?|#)/i.test(request.url)) return true;
    if (!request.isTopFrame) return true; // embedded frames (e.g. maps) stay as they are
    Linking.openURL(request.url).catch(() => {});
    return false;
  }, []);

  const handleRetry = useCallback(() => {
    setHasError(false);
    webViewRef.current?.reload();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={hasError ? ["top", "bottom", "left", "right"] : []}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0F19" translucent />
      {/* Edge-to-edge windows aren't resized for the keyboard — pad instead so inputs stay visible */}
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "android" ? "padding" : undefined}>

      {hasError ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>NetworQ</Text>
          <Text style={styles.errorMessage}>
            Unable to connect to the NetworQ servers. Please check your internet connection.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryButtonText}>Retry Connection</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={{ uri: push.startUrl || TARGET_URL }}
          style={styles.webView}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          allowsBackForwardNavigationGestures={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          originWhitelist={["*"]}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          // window.open / target=_blank: NetworQ pages stay in the app, anything else opens on the phone
          onOpenWindow={(e) => {
            const url = e.nativeEvent.targetUrl;
            if (/^https:\/\/([a-z0-9-]+\.)*networq\.co\.in(\/|$|\?|#)/i.test(url)) {
              webViewRef.current?.injectJavaScript(`window.location.href=${JSON.stringify(url)};true;`);
            } else if (url) {
              Linking.openURL(url).catch(() => {});
            }
          }}
          injectedJavaScriptBeforeContentLoaded={`${safeAreaScript}\n${SHELL_CAPABILITIES_JS}\n${PUSH_CAPABILITY_JS}\n${APPLOCK_CAPABILITY_JS}`}
          onLoadEnd={push.onLoadEnd}
          onMessage={(e) => {
            // any page on our own domain (www or not, any path) can answer the back button
            if (/^https:\/\/([a-z0-9-]+\.)*networq\.co\.in(\/|$)/i.test(e.nativeEvent.url)) handleNavMessage(e.nativeEvent.data);
            radarBridge.onMessage(e);
            googleAuth.onMessage(e);
            push.onMessage(e);
            lock.onMessage(e);
          }}
          cacheEnabled={true}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#7C3AED" />
              <Text style={styles.loadingText}>Loading NetworQ…</Text>
            </View>
          )}
          onNavigationStateChange={(navState: WebViewNavigation) => {
            setCanGoBack(navState.canGoBack);
          }}
          onError={() => setHasError(true)}
          onHttpError={(syntheticEvent: WebViewHttpErrorEvent) => {
            const { nativeEvent } = syntheticEvent;
            if (nativeEvent.statusCode >= 500) {
              setHasError(true);
            }
          }}
        />
      )}
      </KeyboardAvoidingView>
      {/* App lock covers everything until fingerprint / phone passcode */}
      {lock.overlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F19",
  },
  webView: {
    flex: 1,
    backgroundColor: "#0B0F19",
  },
  loadingContainer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#0B0F19",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 12,
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "600",
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: "#0B0F19",
  },
  errorTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 15,
    color: "#94A3B8",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  retryButton: {
    backgroundColor: "#7C3AED",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
