# Event Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real nearby-attendee discovery at events: BLE in the Android app, backend-verified identity, request → accept contact exchange.

**Architecture:** Supabase tables + `security definer` RPCs own all trust decisions. A Kotlin Expo module advertises and scans rotating tokens. The RN WebView shell bridges BLE to the web app. A focused `radar/` folder holds pure proximity logic, the bridge protocol and the Radar UI, replacing the global presence radar in `App.tsx`.

**Tech Stack:** Supabase Postgres / PLpgSQL, Expo Modules API (Kotlin), react-native-webview bridge, React (web), Playwright (unit + E2E).

**Spec:** `docs/superpowers/specs/2026-10-01-event-radar-design.md`

## Global Constraints

- Android first; web gets the attendee list with no distance; no iOS BLE in v1.
- Tokens are 8 random bytes (16 hex chars) and expire after 15 minutes; refresh 2 minutes before expiry.
- Never broadcast or store personal data or coordinates on air or in the DB.
- Distance is shown only as the buckets "Very close", "~3 m", "~5 m", "~10 m", "~20 m", "20 m+", with hysteresis of 2 readings.
- P1m = −62 dBm, n = 2.4, Kalman Q = 0.065, R = 1.4; faded after 12 s unseen, removed after 30 s.
- `resolve_radar_tokens` accepts at most 64 tokens; `join_event_by_code` allows at most 30 failures per user per day.
- Join codes use the format `NQ-` + 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`.
- NetworQ BLE service UUID: `7c3a0e01-6e51-4b2b-9b5f-0e7c3aed0001`.
- UI: primary `#7C3AED`; no vendor names in the UI; toasts, never `alert()`; touch targets ≥ 44 px.
- All existing suites stay green: `npx tsc --noEmit`, `npm test`, `npx playwright test`.

---

### Task 1: Database — events, attendance, tokens, requests, RPCs

**Files:**
- Create: `supabase/migrations/20261002_event_radar.sql`
- Modify: `schema.sql` (append the same objects)

**Interfaces — Produces** (RPC names and JSON shapes used by Tasks 4–6):
- `create_event(p_name text, p_venue text, p_starts_at timestamptz, p_ends_at timestamptz) → jsonb {id, name, venue, starts_at, ends_at, join_code, source}`
- `join_event_by_code(p_code text) → jsonb event | {error:"invalid_code"}` · `join_listed_event(p_external_id text, p_name text, p_venue text, p_starts_at timestamptz) → jsonb event` · `leave_event(p_event_id uuid) → void`
- `my_events() → jsonb[] [{...event, attendee_count, settings:{radar_on, visible, show_distance, show_profile}}]`
- `update_radar_settings(p_event_id uuid, p_radar_on bool, p_visible bool, p_show_distance bool, p_show_profile bool) → jsonb settings`
- `issue_radar_token(p_event_id uuid) → jsonb {token text|null, expires_at}`
- `resolve_radar_tokens(p_event_id uuid, p_tokens text[]) → jsonb {people:[{token,user_id,name,title,company,avatar,show_distance,expires_at}], hidden_count int}`
- `list_event_attendees(p_event_id uuid) → jsonb {people:[...same minus token], hidden_count}`
- `send_connection_request(p_event_id uuid, p_to_user uuid) → jsonb request` · `my_connection_requests(p_event_id uuid) → jsonb {incoming:[{id, from_user, name, title, company, avatar, created_at}], outgoing:[{id, to_user, status}]}` · `respond_connection_request(p_request_id uuid, p_accept bool) → jsonb request`

- [ ] Step 1: Write the migration (tables with RLS, functions with `security definer set search_path = public`, `revoke all from public, anon`, `grant execute to authenticated`).
- [ ] Step 2: Mirror it into `schema.sql`.
- [ ] Step 3: Commit `feat(db): event radar schema and RPCs`.

### Task 2: Pure proximity engine + bridge protocol

**Files:**
- Create: `radar/proximity.ts`, `radar/protocol.ts`
- Test: `tests/unit/proximity.spec.ts`, `tests/unit/protocol.spec.ts`
- Modify: `playwright.config.ts` (add the `unit` project: `testDir tests/unit`, no browser), `tsconfig.json` (include `radar`)

**Interfaces — Produces:**
```ts
// radar/proximity.ts
export type DistanceBucket = "very_close" | "3m" | "5m" | "10m" | "20m" | "far";
export const BUCKET_LABEL: Record<DistanceBucket, string>;
export function rssiToMeters(rssi: number, p1m?: number, n?: number): number;
export function metersToBucket(m: number): DistanceBucket;
export class KalmanRssi { constructor(q?: number, r?: number); update(rssi: number): number; }
export interface Sighting { token: string; rssi: number; ts: number }
export interface Track { token: string; userId?: string; filteredRssi: number; meters: number; bucket: DistanceBucket; lastSeen: number; faded: boolean }
export class ProximityTracker {
  ingest(sightings: Sighting[]): void;
  bindUser(token: string, userId: string): void;
  snapshot(now: number): Track[];            // drops > 30 s, marks faded > 12 s
  byUser(now: number): Map<string, Track>;   // freshest track per user
  unknownTokens(now: number): string[];      // tokens without a userId
}
// radar/protocol.ts
export type NativeState = "on" | "off" | "unauthorized" | "unsupported" | "no_advertiser";
export type WebToNative = { type: "radar:capabilities" } | { type: "radar:start"; token: string | null } | { type: "radar:token"; token: string | null } | { type: "radar:stop" } | { type: "radar:openSettings" };
export type NativeToWeb = { type: "radar:capabilities"; state: NativeState; permission: "granted" | "denied" | "blocked" } | { type: "radar:state"; state: NativeState } | { type: "radar:sightings"; items: Sighting[] } | { type: "radar:error"; code: string; message: string };
export function isNativeToWeb(x: unknown): x is NativeToWeb;
export function isWebToNative(x: unknown): x is WebToNative;
export const isHexToken: (s: unknown) => s is string; // /^[0-9a-f]{16}$/
```

- [ ] Step 1: Write the unit tests:
  - `rssiToMeters(-62) ≈ 1`
  - `rssiToMeters(-86.0) ≈ 10 ± 0.5`
  - bucket boundaries 1.49→very_close, 1.5→3m, 3.99→3m, 4→5m, 6.99→5m, 7→10m, 12.99→10m, 13→20m, 24.99→20m, 25→far
  - Kalman: a noisy series around −70 converges within ±2 after 10 samples
  - hysteresis: one outlier does not change the bucket, two do
  - staleness: 12 s → faded, 31 s → removed
  - dedupe: two tokens bound to one user → `byUser` keeps the freshest
  - protocol guards reject unknown types and bad tokens
- [ ] Step 2: Run `npx playwright test --project=unit` → FAIL (modules missing).
- [ ] Step 3: Implement both modules.
- [ ] Step 4: Run `--project=unit` → PASS; `npx tsc --noEmit` → 0 errors.
- [ ] Step 5: Commit `feat(radar): proximity engine and bridge protocol`.

### Task 3: Native BLE module + shell bridge

**Files:**
- Create: `modules/networq-radar/expo-module.config.json`, `modules/networq-radar/index.ts`, `modules/networq-radar/android/build.gradle`, `modules/networq-radar/android/src/main/AndroidManifest.xml`, `modules/networq-radar/android/src/main/java/expo/modules/networqradar/NetworqRadarModule.kt`
- Create: `radar/nativeBridge.native.ts` (shell side: permissions, AppState, module ⇄ WebView)
- Modify: `App.native.tsx` + `App.android.tsx` (wire `onMessage` and `injectJavaScript`), `app.json` (permissions), `android/app/src/main/AndroidManifest.xml` (BLE permissions)

**Interfaces — Consumes:** `WebToNative`, `NativeToWeb`, `isWebToNative` from Task 2. **Produces:** the JS module `NetworqRadar` with `getState(): NativeState`, `start(tokenHex: string | null): void`, `setToken(tokenHex: string | null): void`, `stop(): void`, `openBluetoothSettings(): void`, plus events `onSightings({items})` and `onStateChange({state})`.

- [ ] Step 1: Kotlin module:
  - advertise service data `UUID → token bytes` (when the token is non-null), non-connectable
  - scan with a `ScanFilter.setServiceData(uuid, ByteArray(0))`
  - buffer sightings and flush every 1500 ms on the main looper
  - adapter-state `BroadcastReceiver`
  - every BLE call guarded by try/catch `SecurityException` → `unauthorized`
- [ ] Step 2: Shell bridge:
  - `PermissionsAndroid.requestMultiple` (API ≥ 31: `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`; else `ACCESS_FINE_LOCATION`)
  - stop on background, resume on foreground when wanted
  - send to the web: `webView.injectJavaScript("window.dispatchEvent(new CustomEvent('networq-native',{detail:" + JSON + "}));true;")`
- [ ] Step 3: Install OpenJDK 17, run `cd android && ./gradlew :app:compileDebugKotlin` (then `assembleDebug`) → BUILD SUCCESSFUL.
- [ ] Step 4: `npx tsc --noEmit` → 0 errors.
- [ ] Step 5: Commit `feat(android): BLE radar native module and WebView bridge`.

### Task 4: Radar data client (web)

**Files:**
- Create: `radar/radarApi.ts` (typed RPC wrappers), `radar/useEventRadar.ts` (hook: membership, settings, token lifecycle, native or fallback mode, resolve loop, requests polling)

**Interfaces — Consumes:** Task 1 RPCs, Task 2 `ProximityTracker` and protocol. **Produces:**
```ts
export interface RadarPerson { userId: string; name: string; title?: string; company?: string; avatar?: string; bucket: DistanceBucket | null; faded: boolean; showDistance: boolean }
export type RadarMode = "native" | "web";
export type RadarStatus = "idle" | "starting" | "scanning" | "bluetooth_off" | "permission_denied" | "unsupported" | "scan_only" | "paused" | "offline";
export function useEventRadar(opts: { supabase: SupabaseClient; userId: string; eventId: string | null; onContactsChanged: () => void }): {
  mode: RadarMode; status: RadarStatus; people: RadarPerson[]; hiddenCount: number;
  settings: RadarSettings | null; updateSettings(p: Partial<RadarSettings>): Promise<void>;
  incoming: IncomingRequest[]; outgoing: Map<string, "pending" | "accepted" | "declined">;
  connect(userId: string): Promise<void>; respond(requestId: string, accept: boolean): Promise<void>;
  openBluetoothSettings(): void; retryPermissions(): void;
}
```

- [ ] Step 1: Implement with the 1 s render tick, a 2 s resolve loop for unknown tokens, 10 s request polling, and token refresh at `expires_at − 120 s`.
- [ ] Step 2: `npx tsc --noEmit` → 0.
- [ ] Step 3: Commit `feat(radar): data client hook`.

### Task 5: Radar UI and App integration (removes the global presence radar)

**Files:**
- Create: `radar/EventRadar.tsx` (container: no-event hero, event header, canvas, nearby list, sheets, privacy panel, states), `radar/RadarCanvas.tsx` (canvas drawing)
- Modify: `App.tsx`:
  - replace the `tab === "radar"` body with `<EventRadar …/>`
  - delete `RealRadarCanvas` and the `networq-radar-live` channel
  - add "I'm attending" on Events Hub cards (calls `join_listed_event` and opens Radar)

**Interfaces — Consumes:** `useEventRadar`, `radarApi`, `BUCKET_LABEL`.

- [ ] Step 1: Build the UI per spec §4 with accessible names:
  - buttons "Join event", "Create event", "Connect", "Accept", "Decline", "Leave event"
  - switches "Radar", "Visible to nearby attendees", "Show distance", "Show profile"
  - list `aria-label="Nearby attendees"`
- [ ] Step 2: `npx tsc --noEmit` → 0; `npm run build` OK; the existing E2E suite stays green.
- [ ] Step 3: Commit `feat(radar): Event Radar UI; remove global presence radar`.

### Task 6: E2E + live tests, docs

**Files:**
- Modify: `tests/e2e/mock-supabase.ts` (RPC handler `/rest/v1/rpc/:fn` implementing Task 1 semantics in memory)
- Create: `tests/e2e/radar.spec.ts`
- Modify: `tests/integration/supabase-rls.test.js` (radar RPC isolation, skipped until the migration is applied), `docs/QA_REPORT.md`, `.claude/agents/qa-mobile-release-tester.md` (two-phone BLE checklist)

- [ ] Step 1: E2E scenarios:
  - create event shows the `NQ-` code
  - B joins by code
  - inject native bridge + sightings → "~5 m"
  - outsider token ignored
  - Connect → B accepts → both have the contact
  - incognito → hidden count
  - web fallback list
  - Bluetooth off → "Turn on Bluetooth"
  - permission denied → retry
- [ ] Step 2: `npx playwright test` → all green; `npm test` → green.
- [ ] Step 3: Commit `test(radar): E2E and live isolation tests; docs`.
