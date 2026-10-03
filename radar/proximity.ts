// Turns raw BLE sightings into smoothed, honest distance ranges.
// Model and smoothing follow the Google Exposure Notifications approach
// (attenuation → distance) with a 1-D Kalman filter per token.
import { isHexToken, type Sighting } from "./protocol";

export type { Sighting };

export type DistanceBucket = "very_close" | "3m" | "5m" | "10m" | "20m" | "far";

export const BUCKET_LABEL: Record<DistanceBucket, string> = {
  very_close: "Very close",
  "3m": "~3 m",
  "5m": "~5 m",
  "10m": "~10 m",
  "20m": "~20 m",
  far: "20 m+",
};

// Upper bound (exclusive) of each bucket in meters, in order
const BUCKET_LIMITS: [DistanceBucket, number][] = [
  ["very_close", 1.5],
  ["3m", 4],
  ["5m", 7],
  ["10m", 13],
  ["20m", 25],
];

export const P1M_DBM = -62; // RSSI measured at 1 m
export const PATH_LOSS_N = 2.4; // indoor environment
export const FADE_AFTER_MS = 12_000;
export const DROP_AFTER_MS = 30_000;
const HYSTERESIS_READINGS = 2;

export function rssiToMeters(rssi: number, p1m = P1M_DBM, n = PATH_LOSS_N): number {
  return Math.pow(10, (p1m - rssi) / (10 * n));
}

export function metersToBucket(m: number): DistanceBucket {
  for (const [bucket, limit] of BUCKET_LIMITS) if (m < limit) return bucket;
  return "far";
}

export class KalmanRssi {
  private x: number | null = null;
  private p = 1;

  constructor(private readonly q = 0.065, private readonly r = 1.4) {}

  update(rssi: number): number {
    if (this.x === null) {
      this.x = rssi;
      return rssi;
    }
    this.p += this.q;
    const k = this.p / (this.p + this.r);
    this.x += k * (rssi - this.x);
    this.p *= 1 - k;
    return this.x;
  }
}

export interface Track {
  token: string;
  userId?: string;
  filteredRssi: number;
  meters: number;
  bucket: DistanceBucket;
  lastSeen: number;
  faded: boolean;
}

interface TrackState {
  token: string;
  userId?: string;
  filter: KalmanRssi;
  filteredRssi: number;
  bucket: DistanceBucket;
  candidate: DistanceBucket | null;
  candidateCount: number;
  lastSeen: number;
}

const validRssi = (rssi: number) => Number.isFinite(rssi) && rssi < 0 && rssi >= -127;

export class ProximityTracker {
  private tracks = new Map<string, TrackState>();

  ingest(sightings: Sighting[]): void {
    for (const s of sightings) {
      if (!isHexToken(s.token) || !validRssi(s.rssi) || !Number.isFinite(s.ts)) continue;
      let t = this.tracks.get(s.token);
      if (!t) {
        const bucket = metersToBucket(rssiToMeters(s.rssi));
        t = { token: s.token, filter: new KalmanRssi(), filteredRssi: s.rssi, bucket, candidate: null, candidateCount: 0, lastSeen: s.ts };
        t.filter.update(s.rssi);
        this.tracks.set(s.token, t);
        continue;
      }
      t.filteredRssi = t.filter.update(s.rssi);
      t.lastSeen = Math.max(t.lastSeen, s.ts);
      const next = metersToBucket(rssiToMeters(t.filteredRssi));
      if (next === t.bucket) {
        t.candidate = null;
        t.candidateCount = 0;
      } else if (next === t.candidate) {
        t.candidateCount += 1;
        if (t.candidateCount >= HYSTERESIS_READINGS) {
          t.bucket = next;
          t.candidate = null;
          t.candidateCount = 0;
        }
      } else {
        t.candidate = next;
        t.candidateCount = 1;
      }
    }
  }

  bindUser(token: string, userId: string): void {
    const t = this.tracks.get(token);
    if (t) t.userId = userId;
  }

  forget(token: string): void {
    this.tracks.delete(token);
  }

  snapshot(now: number): Track[] {
    const out: Track[] = [];
    for (const [token, t] of this.tracks) {
      const age = now - t.lastSeen;
      if (age > DROP_AFTER_MS) {
        this.tracks.delete(token);
        continue;
      }
      out.push({
        token,
        userId: t.userId,
        filteredRssi: t.filteredRssi,
        meters: rssiToMeters(t.filteredRssi),
        bucket: t.bucket,
        lastSeen: t.lastSeen,
        faded: age > FADE_AFTER_MS,
      });
    }
    return out;
  }

  byUser(now: number): Map<string, Track> {
    const best = new Map<string, Track>();
    for (const t of this.snapshot(now)) {
      if (!t.userId) continue;
      const cur = best.get(t.userId);
      if (!cur || t.lastSeen > cur.lastSeen) best.set(t.userId, t);
    }
    return best;
  }

  boundTokens(now: number): string[] {
    return this.snapshot(now).filter((t) => t.userId).map((t) => t.token);
  }

  unknownTokens(now: number): string[] {
    return this.snapshot(now).filter((t) => !t.userId).map((t) => t.token);
  }
}
