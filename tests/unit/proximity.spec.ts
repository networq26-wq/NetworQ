import { test, expect } from "@playwright/test";
import { rssiToMeters, metersToBucket, KalmanRssi, ProximityTracker, BUCKET_LABEL } from "../../radar/proximity";

test("log-distance model: -62 dBm ≈ 1 m, -86 dBm ≈ 10 m", () => {
  expect(rssiToMeters(-62)).toBeCloseTo(1, 5);
  expect(rssiToMeters(-86)).toBeGreaterThan(9.5);
  expect(rssiToMeters(-86)).toBeLessThan(10.5);
});

test("bucket boundaries", () => {
  const cases: [number, string][] = [
    [0.3, "very_close"], [1.49, "very_close"], [1.5, "3m"], [3.99, "3m"], [4, "5m"], [6.99, "5m"],
    [7, "10m"], [12.99, "10m"], [13, "20m"], [24.99, "20m"], [25, "far"], [80, "far"],
  ];
  for (const [m, b] of cases) expect(metersToBucket(m), `${m} m`).toBe(b);
  expect(BUCKET_LABEL["5m"]).toBe("~5 m");
  expect(BUCKET_LABEL.very_close).toBe("Very close");
  expect(BUCKET_LABEL.far).toBe("20 m+");
});

test("Kalman filter converges on a noisy signal", () => {
  const k = new KalmanRssi();
  const noise = [6, -5, 4, -7, 3, -2, 5, -4, 2, -3, 1, -1];
  let last = 0;
  for (const n of noise) last = k.update(-70 + n);
  expect(Math.abs(last - -70)).toBeLessThan(2);
});

test("a single outlier does not change the bucket; a sustained change does", () => {
  const t = new ProximityTracker();
  const now = 1_000_000;
  for (let i = 0; i < 12; i++) t.ingest([{ token: "aaaaaaaaaaaaaaaa", rssi: -75, ts: now + i * 1000 }]);
  const before = t.snapshot(now + 12_000)[0].bucket;
  t.ingest([{ token: "aaaaaaaaaaaaaaaa", rssi: -45, ts: now + 12_500 }]); // one spike
  expect(t.snapshot(now + 12_600)[0].bucket).toBe(before);
  for (let i = 0; i < 25; i++) t.ingest([{ token: "aaaaaaaaaaaaaaaa", rssi: -50, ts: now + 13_000 + i * 500 }]);
  expect(t.snapshot(now + 26_000)[0].bucket).toBe("very_close");
});

test("tracks fade after 12 s and disappear after 30 s", () => {
  const t = new ProximityTracker();
  t.ingest([{ token: "bbbbbbbbbbbbbbbb", rssi: -70, ts: 0 }]);
  expect(t.snapshot(11_000)[0].faded).toBe(false);
  expect(t.snapshot(12_500)[0].faded).toBe(true);
  expect(t.snapshot(31_000)).toHaveLength(0);
});

test("rotated tokens for one user merge into the freshest track", () => {
  const t = new ProximityTracker();
  t.ingest([{ token: "1111111111111111", rssi: -80, ts: 1000 }]);
  t.ingest([{ token: "2222222222222222", rssi: -60, ts: 5000 }]);
  expect(t.unknownTokens(6000).sort()).toEqual(["1111111111111111", "2222222222222222"]);
  t.bindUser("1111111111111111", "user-1");
  t.bindUser("2222222222222222", "user-1");
  const byUser = t.byUser(6000);
  expect(byUser.size).toBe(1);
  expect(byUser.get("user-1")!.token).toBe("2222222222222222");
  expect(t.unknownTokens(6000)).toEqual([]);
});

test("invalid sightings are ignored", () => {
  const t = new ProximityTracker();
  t.ingest([
    { token: "not-hex", rssi: -60, ts: 1 },
    { token: "cccccccccccccccc", rssi: 20, ts: 1 },      // impossible RSSI
    { token: "cccccccccccccccc", rssi: Number.NaN, ts: 1 },
  ]);
  expect(t.snapshot(2)).toHaveLength(0);
});
