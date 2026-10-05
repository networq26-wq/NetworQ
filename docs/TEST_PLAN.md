# Test Plan — NetworQ

## Automated (run before every release)

| Suite | Command | Covers |
|---|---|---|
| Types | `npx tsc --noEmit -p .` | whole app |
| Unit + API + DB | `NETWORQ_SKIP_DOTENV=1 npm test` | `tests/api/*` (AI, email + ICS, events import/crawler, prospect, push, notify hook, transcribe, ICE, TTS, account, security helpers) and `tests/db/*` on PGlite (radar, nearby, connections, notifications, push, chat, **calls**, events, prospect, hardening, account) |
| End-to-end | `npm run build && npx playwright test` | `tests/e2e/*` on desktop Chrome (1440×900) and Pixel 7 — auth, contacts, events, meetings, notifications, radar (two browsers), settings, mobile app behaviour (back button, Me, select & bulk email, camera permission), quality sweep (no crash/overflow), voice |

Notes: E2E serves `dist/`, so build first. Radar specs run serially. On an 8 GB machine keep 2 workers and prefix long runs with `caffeinate -i`.

### Live checks on the preview (`tests/debug/`, real Supabase)
- `zz-call.spec.ts` — two browsers: video call rings (< 1 s), connects (~5 s), video both ways, mute / camera, hang-up both sides, decline.
- `zz-voice.spec.ts` — real speech into the fake mic → Whisper transcript → extracted details → reminder day → saved.
- `preview-chat.spec.ts` — live chat between two accounts.
- `zz-people/events/radar/msg/card/logo` — screenshots for visual review.

## Manual — on two real Android phones (APK) before a store release

**Install & sign-in**
- [ ] Install APK, open → splash → sign in (email) and with Google (system browser returns to the app)
- [ ] Back button: from any sheet/sub-page/tab it steps back; on People home it says "Press back again to exit"

**Capture**
- [ ] Scan a card with the camera (permission prompt appears once) → details correct → save
- [ ] Voice note: allow microphone → level meter moves → transcript → details → reminder day → saved
- [ ] My QR: another phone's camera scans it and offers to save the contact

**Follow up**
- [ ] Who's next shows the right people; Email opens a draft; Select → Email 2 sends two emails
- [ ] Meeting with Google Meet / pasted link / Jitsi → recipient gets the invite with Accept/Decline

**Connect**
- [ ] Radar Nearby on both phones (Bluetooth on) → they see each other with distance → request → accept → contact added on both
- [ ] Message: both directions, typing indicator, read ticks, push when the app is in the background
- [ ] Voice call and video call: rings when the other app is open, and via push when it's closed; accept, mute, camera, flip, end; decline shows "Declined"; unanswered → "No answer" + missed call in the bell
- [ ] Calls on mobile data on both phones (if they fail, add a TURN relay)

**Events**
- [ ] Location sheet, date control, calendar day, categories; Going → event Radar; Add to calendar

**Account**
- [ ] Notifications on/off, dark mode, blocked people, recent devices, export, sign out

## Release gate
GO only when: types clean, `npm test` all green, E2E green (flaky radar specs re-run alone), no secrets in the bundle, and the manual checklist passed on two phones for any shell change.
