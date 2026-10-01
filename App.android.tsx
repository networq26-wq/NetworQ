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
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useRadarBridge } from "./radar/shellBridge";
import { SHELL_CAPABILITIES_JS, useGoogleAuthBridge } from "./shell/googleAuth";
import type { WebViewNavigation, WebViewHttpErrorEvent, ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";

const TARGET_URL = "https://www.networq.co.in";

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const webViewRef = useRef<React.ElementRef<typeof WebView>>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [hasError, setHasError] = useState(false);
  const radarBridge = useRadarBridge(webViewRef, TARGET_URL);
  const googleAuth = useGoogleAuthBridge(webViewRef, TARGET_URL);

  // Hardware back: let the web app close overlays / go to the previous tab first;
  // on the home screen, a second press within 2 s exits.
  const lastBackAt = useRef(0);
  const hasErrorRef = useRef(false);
  hasErrorRef.current = hasError;
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const onBackPress = () => {
      if (hasErrorRef.current) return false; // offline screen: let Android close the app
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
      if (msg?.type !== "nav:back" || msg.handled) return;
      if (canGoBack) return webViewRef.current?.goBack(); // e.g. from /privacy back to the app
      const now = Date.now();
      if (now - lastBackAt.current < 2000) return BackHandler.exitApp();
      lastBackAt.current = now;
      ToastAndroid.show("Press back again to exit", ToastAndroid.SHORT);
    },
    [canGoBack]
  );

  // mailto:, tel:, sms:, intent: etc. can't load inside the WebView — hand them to the OS
  const handleShouldStartLoad = useCallback((request: ShouldStartLoadRequest) => {
    if (/^(https?|about|data|blob):/i.test(request.url)) return true;
    Linking.openURL(request.url).catch(() => {});
    return false;
  }, []);

  const handleRetry = useCallback(() => {
    setHasError(false);
    webViewRef.current?.reload();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom", "left", "right"]}>
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
          source={{ uri: TARGET_URL }}
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
          injectedJavaScriptBeforeContentLoaded={SHELL_CAPABILITIES_JS}
          onMessage={(e) => {
            if (e.nativeEvent.url.startsWith(TARGET_URL)) handleNavMessage(e.nativeEvent.data);
            radarBridge.onMessage(e);
            googleAuth.onMessage(e);
          }}
          cacheEnabled={true}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#6366F1" />
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
    backgroundColor: "#6366F1",
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
