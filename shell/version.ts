// Version of the native Android shell (the APK / Play Store app), told to the web app on every page load.
// Bump SHELL_BUILD whenever native code changes (Bluetooth, permissions, notifications…), so the web app can
// tell people on an older install to update instead of failing silently. Installs from before this existed
// report nothing and are treated as build 1.
export const SHELL_BUILD = 2;
export const SHELL_VERSION_JS = `window.__NETWORQ_SHELL__ = Object.assign(window.__NETWORQ_SHELL__ || {}, { build: ${SHELL_BUILD}, platform: "android" }); true;`;
