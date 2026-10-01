import { test, expect } from "@playwright/test";
import { isNativeToWeb, isWebToNative, isHexToken } from "../../radar/protocol";

test("hex tokens", () => {
  expect(isHexToken("0123456789abcdef")).toBe(true);
  expect(isHexToken("0123456789ABCDEF")).toBe(false);
  expect(isHexToken("0123")).toBe(false);
  expect(isHexToken(42)).toBe(false);
});

test("native → web guard", () => {
  expect(isNativeToWeb({ type: "radar:state", state: "on" })).toBe(true);
  expect(isNativeToWeb({ type: "radar:state", state: "exploded" })).toBe(false);
  expect(isNativeToWeb({ type: "radar:sightings", items: [{ token: "0123456789abcdef", rssi: -70, ts: 1 }] })).toBe(true);
  expect(isNativeToWeb({ type: "radar:sightings", items: [{ token: "zz", rssi: -70, ts: 1 }] })).toBe(false);
  expect(isNativeToWeb({ type: "radar:capabilities", state: "off", permission: "denied" })).toBe(true);
  expect(isNativeToWeb({ type: "radar:error", code: "advertise_failed", message: "x" })).toBe(true);
  expect(isNativeToWeb({ type: "evil" })).toBe(false);
  expect(isNativeToWeb(null)).toBe(false);
});

test("web → native guard", () => {
  expect(isWebToNative({ type: "radar:start", token: "0123456789abcdef" })).toBe(true);
  expect(isWebToNative({ type: "radar:start", token: null })).toBe(true);
  expect(isWebToNative({ type: "radar:start", token: "<script>" })).toBe(false);
  expect(isWebToNative({ type: "radar:stop" })).toBe(true);
  expect(isWebToNative({ type: "radar:openSettings" })).toBe(true);
  expect(isWebToNative({ type: "shell:exec" })).toBe(false);
});
