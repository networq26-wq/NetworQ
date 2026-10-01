// JS facade for the native Event Radar BLE module (Android only).
import { requireOptionalNativeModule } from "expo-modules-core";
import type { NativeState, Sighting } from "../../radar/protocol";

interface Subscription {
  remove(): void;
}

export interface NetworqRadarNative {
  getState(): NativeState;
  start(tokenHex: string | null): NativeState;
  setToken(tokenHex: string | null): void;
  stop(): void;
  openBluetoothSettings(): void;
  addListener(event: "onSightings", cb: (e: { items: Sighting[] }) => void): Subscription;
  addListener(event: "onStateChange", cb: (e: { state: NativeState }) => void): Subscription;
  addListener(event: "onError", cb: (e: { code: string; message: string }) => void): Subscription;
}

// null in Expo Go, on iOS, or in builds made before the module existed
export default requireOptionalNativeModule<NetworqRadarNative>("NetworqRadar");
