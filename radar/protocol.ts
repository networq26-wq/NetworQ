// Message contract between the NetworQ web app and the Android WebView shell.
// Both sides validate every message — the WebView boundary is a trust boundary.

export const RADAR_SERVICE_UUID = "7c3a0e01-6e51-4b2b-9b5f-0e7c3aed0001";

export type NativeState = "on" | "off" | "unauthorized" | "unsupported" | "no_advertiser";
export type PermissionState = "granted" | "denied" | "blocked";

export interface Sighting {
  token: string;
  rssi: number;
  ts: number;
}

export type WebToNative =
  | { type: "radar:capabilities" }
  | { type: "radar:start"; token: string | null }
  | { type: "radar:token"; token: string | null }
  | { type: "radar:stop" }
  | { type: "radar:openSettings" };

export type NativeToWeb =
  | { type: "radar:capabilities"; state: NativeState; permission: PermissionState }
  | { type: "radar:state"; state: NativeState }
  | { type: "radar:sightings"; items: Sighting[] }
  | { type: "radar:error"; code: string; message: string };

const NATIVE_STATES: readonly string[] = ["on", "off", "unauthorized", "unsupported", "no_advertiser"];
const PERMISSIONS: readonly string[] = ["granted", "denied", "blocked"];

export const isHexToken = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{16}$/.test(s);

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

export function isSighting(x: unknown): x is Sighting {
  return (
    isObj(x) &&
    isHexToken(x.token) &&
    typeof x.rssi === "number" &&
    Number.isFinite(x.rssi) &&
    typeof x.ts === "number" &&
    Number.isFinite(x.ts)
  );
}

export function isNativeToWeb(x: unknown): x is NativeToWeb {
  if (!isObj(x)) return false;
  switch (x.type) {
    case "radar:capabilities":
      return NATIVE_STATES.includes(x.state as string) && PERMISSIONS.includes(x.permission as string);
    case "radar:state":
      return NATIVE_STATES.includes(x.state as string);
    case "radar:sightings":
      return Array.isArray(x.items) && x.items.length <= 512 && x.items.every(isSighting);
    case "radar:error":
      return typeof x.code === "string" && typeof x.message === "string";
    default:
      return false;
  }
}

export function isWebToNative(x: unknown): x is WebToNative {
  if (!isObj(x)) return false;
  switch (x.type) {
    case "radar:capabilities":
    case "radar:stop":
    case "radar:openSettings":
      return true;
    case "radar:start":
    case "radar:token":
      return x.token === null || isHexToken(x.token);
    default:
      return false;
  }
}

// Window event the shell dispatches into the page
export const NATIVE_EVENT = "networq-native";
