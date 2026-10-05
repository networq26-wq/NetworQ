# Architecture — NetworQ

## At a glance

```
 Phone (Android app = WebView shell)        Browser (desktop / mobile)
   App.native.tsx ── camera, mic, BLE,          │
   push, back button bridges                     │
            └───────────────┬────────────────────┘
                            ▼
              https://www.networq.co.in  (Render, auto-deploy from main)
              node server.js  ── serves the web app (dist/) + /api/*
                            │
     ┌──────────────┬───────┴────────┬───────────────┬──────────────┐
     ▼              ▼                ▼               ▼              ▼
  Supabase       Groq AI          Resend         Expo Push /     Event sources
  Postgres+RLS   chat, vision,    email +        Web Push        (Luma, Eventbrite,
  Auth, Realtime Whisper, TTS     calendar       (VAPID)         Meetup, .ics)
  Storage                         invites
```

- **One web codebase** (React + Expo/react-native-web). The Android app is a thin native shell that loads the live site and adds native capabilities through `postMessage` bridges. Most releases reach phones without a new APK.
- **Data access** goes straight from the app to Supabase with the user's own session; **RLS and security-definer RPCs** enforce who can see and do what. The Express server only does what a browser can't: AI, email, push, transcription, web research, calendar import, TURN credentials.

---

## Front end

| Area | Files |
|---|---|
| App shell, navigation, home, contacts, scan, meetings, AI panel | `App.tsx` |
| Me + settings sub-pages | `me/MeScreen.tsx`, `settings/SettingsScreen.tsx`, `settings/MoreSettings.tsx` |
| Card | `pass/CardPass.tsx` (card, QR sheet, card settings), `pass/NfcWriterModal.tsx` |
| Messages & chat | `messages/MessagesScreen.tsx` (inbox + New message), `chat/ChatModal.tsx`, `chat/chatApi.ts` |
| Calls | `calls/CallLayer.tsx` (ring/UI), `calls/CallSession.ts` (WebRTC), `calls/media.ts` (permissions) |
| Voice | `voice/useVoiceRecorder.ts`, `scanner/LazyVoiceDebriefModal.tsx` |
| People helpers | `people/PeopleExtras.tsx` (Who's next, group message), `people/ComingUp.tsx` |
| Radar | `radar/EventRadar.tsx`, `radar/useEventRadar.ts`, `radar/proximity.ts`, `radar/shellBridge.ts` |
| Events | `events/EventsHub.tsx` |
| Notifications & push | `notifications/*`, `shell/pushBridge.ts`, `public/sw.js` |
| Shared UI | `ui/icons.tsx` (one icon set, skeletons, success check), motion CSS in `App.tsx` |

**Navigation (phone):** bottom bar *People · Messages · Radar · Events*; the header avatar opens *Me*. Back steps through: topmost sheet → sub-page → previous tab → home; exits only from home (shell confirms with "Press back again").

## Android shell (`App.native.tsx` ≡ `App.android.tsx`)
- Loads `https://www.networq.co.in` in a WebView (edge-to-edge, safe-area injected).
- Bridges: `nav:back` (with a 600 ms fallback), `perm:camera`, `perm:media` (mic + camera before calls / voice notes), Bluetooth radar (`modules/networq-radar`), Google sign-in in the system browser (PKCE), push token registration.
- Built in the cloud by EAS (`npm run build:apk`); `android/` is generated, never committed.

---

## Server (`server.js` + `api/`)

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/health`, `/api/version` | – | Status |
| `POST /api/ai` | session | Groq chat/extraction proxy (honest 503s when busy — no canned replies) |
| `POST /api/transcribe` | session | Audio → text (Whisper), 8 MB cap, 20/min |
| `POST /api/tts` | session | Text → speech (Orpheus) |
| `POST /api/email` | session | Resend email, optional `.ics` invite attachment |
| `POST /api/prospect/research`, `/prospect/draft`, `/organization/autofill` | session | Website research, 3 drafts, fact-check |
| `POST /api/events/import` | session | Import an event page / `.ics` feed |
| `GET /api/calls/ice` | session | STUN, plus TURN when configured |
| `GET /api/google/available`, `GET /api/google/signin` | – | Google sign-in on networq.co.in → ID token handed to the app (fragment / `networq://auth-callback`) |
| `POST /api/google/connect`, `GET /api/google/callback`, `GET /api/google/status`, `POST /api/google/disconnect` | session (callback: signed state) | Connect Google Calendar once; refresh token stored encrypted |
| `POST /api/google/meet` | session | Create a Calendar event with a Google Meet link; Google emails the invite |
| `GET /api/push/config` | – | Public VAPID key |
| `POST /api/hooks/notification` | shared secret | DB webhook → push + email for each new notification |
| `/api/auth/session-event`, `/api/account/*` | session | Sign-in emails, secure account actions, deletion |
| `/waitlist` | – | Waitlist page (`WAITLIST_MODE` serves it at `/`) |

Rate limits are mounted before routes (global 600/15 min; tighter per endpoint). Background jobs (`NETWORQ_JOBS`): reminders, events crawler, account purge.

### Environment variables (server)
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PUBLIC_APP_URL`, `ALLOWED_ORIGIN`, `LINK_SIGNING_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `EXPO_ACCESS_TOKEN`, `NETWORQ_JOBS`, `EVENTS_CRAWLER`, `GOOGLE_CLIENT_SECRET` (+ `EXPO_PUBLIC_GOOGLE_CLIENT_ID`), `ELEVENLABS_API_KEY` (+ optional `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`), optional TURN (`CF_TURN_KEY_ID` + `CF_TURN_API_TOKEN`, or `TURN_URLS` + `TURN_USERNAME` + `TURN_CREDENTIAL`), optional SMTP/Gmail fallback, `TTS_VOICE`, `WAITLIST_MODE`.

---

## Data (Supabase)

Migrations: `supabase/migrations/20261001…20261017` (applied in order by `scripts/setup-supabase.mjs`).

| Table | What | Access |
|---|---|---|
| `profiles` | name, role, company, photo, notification prefs, radar settings | own row; public card fields via RPC |
| `contacts` | your people: name, title, company, email, phone, tags, notes (`reference`), reminder/date, email_sent, linked_user_id | owner only |
| `organization_profiles` | your company context for AI emails | owner |
| `prospect_research` | research briefs + sources | owner |
| `events`, `event_attendees`, `radar_tokens`, `event_join_failures` | Event Radar + Nearby (special "Nearby" event) | via RPCs |
| `connection_requests`, `blocks` | connect / block | via RPCs |
| `public_events` | imported real events (category, dedupe key) | read: everyone signed in; write: server |
| `direct_chats`, `chat_messages` | 1:1 + event-room messages | read by members; write only via `send_chat_message` |
| `calls` | ringing / accepted / declined / missed / cancelled / ended | read by the two people; write only via `start_call` / `answer_call` / `end_call` |
| `notifications` | bell items (connection, message, call, reminder, …) + push/email dispatch flags | owner |
| `push_tokens` | Expo / Web Push subscriptions | via RPCs |
| `google_calendar_links` | per-user Google refresh token (AES-256-GCM encrypted) + email | server only (no client access) |
| `login_devices`, `ai_usage`, `app_config`, `waitlist` | devices, AI limits, config, waitlist | scoped |

**Realtime:** `postgres_changes` on `notifications`, `contacts`, `chat_messages`, `calls`; private broadcast channels `chat:<chat_id>` (typing) and `call:<user1>_<user2>` (WebRTC signalling) authorised by `realtime_topic_allowed()`.

## Key flows

**Call:** caller → `start_call` (checks connected/unblocked/rate) → row + `call` notification → callee's app rings via Realtime (or push → `?open=call&call=id`) → `answer_call` → callee joins `call:` channel and says *ready* → caller sends offer → answer → ICE (STUN/TURN) → media peer-to-peer → `end_call`.

**Voice note:** MediaRecorder (mic permission via shell) → `POST /api/transcribe` (Whisper) → `/api/ai` extraction (JSON, no invention) → user reviews → `contacts` insert with reminder.

**Follow-up push:** any `notifications` insert → DB webhook → `/api/hooks/notification` → Expo/Web Push (+ email for connection events) → `pushed_at`.

**Meeting invite:** app builds RFC 5545 `.ics` (`meet/ics.ts`) → `/api/email` validates and attaches it → recipient gets Accept/Decline.
