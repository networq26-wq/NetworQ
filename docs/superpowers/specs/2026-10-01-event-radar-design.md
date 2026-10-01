# Event Radar — Design

**Date:** 2026-10-01  **Status:** Approved (owner delegated remaining decisions)

## Goal

Attendees at the same event discover each other nearby through the NetworQ Android app, with an approximate distance, and exchange contact details only by mutual consent.

Open app → join event → Radar on → BLE discovers nearby phones → backend verifies event/user → Radar shows attendees.

## Decisions

| Topic | Decision |
|---|---|
| Platforms | Android app (BLE) in v1. Web browsers get an attendee list with no distance. iOS later. |
| Joining | Curated / AI-discovered Events Hub events ("I'm attending") **and** user-created events with a 6-char code + QR (`NQ-7K3P9X`). |
| Exchange | Request → accept. Contact details are released only on accept, and both sides get each other saved as contacts. |
| BLE stack | Own Kotlin Expo module (`modules/networq-radar`) for **both** advertising and scanning. One module keeps permission, Bluetooth-state and batching logic in one place. |
| Identity on air | Server-issued random 8-byte tokens, rotated every 15 min. No personal data is ever broadcast. |
| References | Google Exposure Notifications (Apache-2.0) for rotating identifiers and RSSI attenuation; OpenTrace / Discovery read for patterns only (GPL / outdated, no code copied). |
| Background | Foreground only in v1: Radar runs while the Radar screen is open and the app is in front. Shown to the user. |

## 1. Data model (Supabase, RLS on every table)

- `events(id uuid, external_id text unique null, name, venue, starts_at, ends_at, join_code text unique null, source 'listed'|'user', created_by, created_at)`
  - Readable by members of the event and by its creator.
- `event_attendees(event_id, user_id, joined_at, last_seen_at, radar_on bool default true, visible bool default true, show_distance bool default true, show_profile bool default true)`, primary key (event_id, user_id)
  - Owner can read and update their own row only.
- `radar_tokens(token text pk, user_id, event_id, expires_at)` — no RLS grants; only server functions touch it.
- `connection_requests(id, event_id, from_user, to_user, status 'pending'|'accepted'|'declined', created_at, responded_at)`, unique (event_id, from_user, to_user)
  - Both parties can select; changes only through functions.
- `event_join_failures(user_id, day, count)` — brute-force guard for codes.

### Server functions (`security definer`, bound to `auth.uid()`)

| Function | Behaviour |
|---|---|
| `create_event(name, venue, starts_at, ends_at)` | Creates a user event with a unique `NQ-XXXXXX` code; the creator joins it. |
| `join_event_by_code(code)` | Joins. More than 30 failed codes per user per day raises `too_many_attempts`. |
| `join_listed_event(external_id, name, venue, starts_at)` | Upserts the listed event by `external_id`, then joins. |
| `leave_event(event_id)` | Removes membership and tokens. |
| `my_events()` | Events I belong to, with my privacy settings and attendee count. |
| `update_radar_settings(event_id, radar_on, visible, show_distance, show_profile)` | Updates my settings; turning Radar off or going invisible revokes my tokens. |
| `issue_radar_token(event_id)` | Requires membership + `radar_on`. If `visible`, issues a 15-min token and returns `{token, expires_at}`; otherwise returns `{token: null}`. Bumps `last_seen_at`. |
| `resolve_radar_tokens(event_id, tokens[])` | Max 64 tokens. Caller must be a member with Radar on. Returns, for unexpired tokens of **other visible, radar-on members of the same event**: `{token, user_id, name, title, company, avatar, show_distance, expires_at}`. If `show_profile` is false, the name is reduced to the first name and company/avatar are omitted. Callers who are not visible get `{hidden_count}` only — to see people you must be seen. |
| `list_event_attendees(event_id)` | Web fallback: same filters, active in the last 15 min, no distance. |
| `send_connection_request(event_id, to_user)` | Both must be members of the event; no duplicates; cannot target self. |
| `my_connection_requests(event_id)` | Incoming pending requests (with public profile) and outgoing statuses. |
| `respond_connection_request(id, accept)` | Recipient only. On accept, inserts a contact for each side (name, title, company, email from `auth.users`, phone, LinkedIn, `event` = event name, `reference` = "NetworQ Radar"). |

## 2. Native module (Android, Kotlin, Expo Modules API)

`modules/networq-radar` — autolinked local module.

- **Advertise**: `BluetoothLeAdvertiser`, `ADVERTISE_MODE_LOW_LATENCY`, `TX_POWER_MEDIUM`, non-connectable. Payload: service data under the NetworQ 128-bit UUID = 8-byte token (29 bytes total; fits legacy advertising).
- **Scan**: `BluetoothLeScanner` with a `ScanFilter` on the service-data UUID, `SCAN_MODE_LOW_LATENCY`. Sightings are buffered and emitted every 1.5 s as `{items: [{token, rssi, ts}]}`.
- **API**: `getState()` → `on | off | unauthorized | unsupported | no_advertiser`; `start(tokenHex)`; `setToken(tokenHex)`; `stop()`; events `onSightings` and `onStateChange` (Bluetooth adapter on/off broadcast receiver).
- **Permissions** (requested from JS via `PermissionsAndroid`): Android 12+ `BLUETOOTH_SCAN` (`neverForLocation`) + `BLUETOOTH_ADVERTISE`; Android ≤ 11 `ACCESS_FINE_LOCATION`. Manifest legacy `BLUETOOTH`/`BLUETOOTH_ADMIN` with `maxSdkVersion=30`.
- **Lifecycle**: stops on `AppState` background and restarts on foreground if the web side still wants Radar. Advertise failures (e.g. `ADVERTISE_FAILED_TOO_MANY_ADVERTISERS`) are reported, and scan-only mode continues.

### WebView bridge (`radar/protocol.ts`, shared types)

- Web → native (`ReactNativeWebView.postMessage`): `radar:capabilities`, `radar:start {token}`, `radar:token {token}`, `radar:stop`, `radar:openSettings`.
- Native → web: `injectJavaScript` dispatches `window` event `networq-native` with `radar:capabilities {state, permission}`, `radar:state {state}`, `radar:sightings {items}`, `radar:error {code, message}`.
- Only messages from the NetworQ origin are accepted; the native side ignores unknown types.

## 3. Proximity (`radar/proximity.ts`, pure, unit-tested)

- Per token: a 1-D Kalman filter on RSSI (Q = 0.065, R = 1.4), then the log-distance model `d = 10^((P1m − rssi) / (10 · n))` with `P1m = −62 dBm`, `n = 2.4` (indoor).
- Buckets with hysteresis (needs 2 consecutive readings to change): `< 1.5 m` "Very close", `< 4` "~3 m", `< 7` "~5 m", `< 13` "~10 m", `< 25` "~20 m", else "20 m+". Never display raw meters.
- Staleness: not seen for more than 12 s → faded; more than 30 s → removed.
- Dedupe: tokens resolve to `user_id`; rotation duplicates are merged per user, keeping the freshest reading.

## 4. Radar UI (`radar/EventRadar.tsx`)

- **No event**: hero with "Join with code" (input + QR scan through the existing scanner), "Create event", and suggested Events Hub events.
- **Event header**: event name, attendee count, share code + on-device QR, leave.
- **Radar canvas**: dark sonar with 5 / 10 / 20 m rings, sweep animation, YOU at the centre. Attendees are avatars on rings by distance, with a stable angle per user (hash). Labelled honestly: "Rings show approximate distance, not direction." Blips glide between radii (lerp) and fade when stale.
- **Nearby list** under the canvas, sorted by distance (accessible alternative to the canvas).
- **Profile sheet**: public profile → Connect / Requested / Connected.
- **Requests**: badge + sheet; Accept / Decline; accepting adds the contact and refreshes Contacts.
- **Privacy panel**: Radar on/off, Visible (off = incognito), Show distance, Show profile.
- **States**: web browser ("Open the Android app for live distance" + attendee list), Bluetooth off (button opens settings), permission denied (explain + retry), advertising unsupported (scan-only notice), radar paused in background, offline (keeps last readings, retries).
- Polling: requests every 10 s while open; token refresh 2 min before expiry.

## 5. Removals and privacy fixes

- Delete the global `networq-radar-live` Realtime channel and `RealRadarCanvas`: it broadcast every online user's email/phone to all users worldwide and showed fake distances.
- No coordinates are collected or stored anywhere.

## Testing

- **Unit** (Playwright runner, no browser): Kalman convergence, bucket boundaries and hysteresis, staleness, dedupe, protocol guards.
- **E2E** (mock Supabase extended with all RPCs; native bridge simulated with an injected `ReactNativeWebView` and dispatched sightings):
  - create event → code shown
  - second user joins by code
  - sightings → attendee shown with "~5 m"
  - Connect → recipient accepts → both get the contact
  - incognito → hidden + "hidden count" view
  - outsider token ignored
  - web fallback list
  - Bluetooth-off and permission-denied states
  - no CSP violations
- **Live** (opt-in `npm run test:rls`): RLS and function rules for the new tables against Supabase.
- **Native**: `./gradlew :app:assembleDebug` compiles the module (OpenJDK 17). On-device verification with two Android phones is listed as a manual step.

## Out of scope (v1)

iOS BLE, background/locked-screen scanning (Android foreground service), Wi-Fi Direct / Nearby Connections transfer, cross-event discovery.
