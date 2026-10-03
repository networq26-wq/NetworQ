// Vibration feedback, respecting the user's "Vibration" setting (stored per device).
const KEY = "networq.haptics";

export function hapticsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setHapticsEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
}

export function haptic(pattern: number | number[] = 25) {
  if (!hapticsEnabled()) return;
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* unsupported */
  }
}
