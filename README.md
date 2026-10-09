# NetworQ

> **Never lose a conversation again.** Meet someone, capture them in seconds, and always know who to follow up with next.

**Live app:** https://www.networq.co.in · **Waitlist:** https://www.networq.co.in/waitlist · **Android:** APK via EAS (see [Build the Android app](#build-the-android-app))

---

## What it does

| | Feature | In one line |
|---|---|---|
| 👥 | **People (home)** | Who's waiting to hear from you, this week's events near you, and every contact with one-tap Email / Meet. |
| 📇 | **Scan a card** | Camera or photo → AI reads the card → saved contact. Batch-scan a stack of cards. |
| 🎙️ | **Voice note** | Say who you met → Whisper writes it down → AI picks out name, company, next step → you check → saved with a reminder. |
| ✉️ | **Follow-ups** | Personal AI drafts for one person or many; send all at once, paced to stay within limits. |
| 🔬 | **AI prospect research** | Reads a company's public website and writes 3 fact-checked email drafts with sources. |
| 💬 | **Messages** | Private 1:1 chat between connected people — live, typing and read receipts, **photos & files** (📎, up to 10 MB). "New message" lists your contacts. |
| 📞 | **Voice & video calls** | Call any connection — or a **group of up to 6** — it rings on any screen and by push when the app is closed. Mute, camera, flip. |
| 📡 | **Radar** | *Nearby*: NetworQ people around you over Bluetooth (Android app). *Events*: join an event code and see who's there. |
| 🗓️ | **Events** | Auto-scrolling featured events, then real events from Luma, Eventbrite, Meetup and calendar feeds — location, dates, calendar, categories; "Going" opens the event's Radar. |
| 🪪 | **Your card** | Premium credit-card-style digital card with your photo and a QR any phone camera can save; NFC write. |
| 📅 | **Meetings** | Google Meet (connect Google Calendar once — works on web and in the app), a pasted link, or a free Jitsi room — always with a real calendar invite (Accept/Decline). |
| 🔔 | **Notifications** | In-app bell + push (Android via Expo/FCM, browsers via Web Push) for messages, calls, connections, reminders. |
| ⚙️ | **Me** | Profile, card, organization, notifications, privacy & blocking, password & devices, appearance, data export, account. |

Everything shown is real data — no sample contacts, invented events or fake AI fallbacks.

---

## Stack

| Layer | Technology |
|---|---|
| App | React (Expo SDK 55 + react-native-web) — one codebase for web and the Android shell |
| Android | Expo WebView shell (`App.native.tsx` = `App.android.tsx`), EAS cloud builds |
| Server | Node.js + Express (`server.js`, `api/*`) on **Render**, auto-deploys from `main` |
| Data / auth / realtime | **Supabase** — Postgres with RLS, security-definer RPCs, Realtime channels, Storage |
| AI | **Groq** — `qwen/qwen3.8-27b` and `openai/gpt-oss-120b/20b` (chat, extraction, drafting), `whisper-large-v3-turbo` (speech→text), vision for card scans · **ElevenLabs** natural voice (Groq Orpheus fallback) |
| Email | **Resend** (SMTP fallback) |
| Push | Expo Push → FCM (Android) · Web Push with VAPID (browsers) |
| Calls | WebRTC peer-to-peer; signalling on private Supabase Realtime channels; optional TURN relay |
| Google | Sign-in via networq.co.in (ID token → Supabase); Calendar/Meet via per-user encrypted refresh tokens on the server |
| Marketing | `public/waitlist.html` served by `server.js`; marketing site in `landing/` (TanStack Start, on the Gemini branch) |

---

## Run it locally

```bash
npm install
cp .env.example .env              # fill in keys — never commit .env
PORT=3001 node server.js          # API on http://localhost:3001
npx expo start --web --port 8082  # app on http://localhost:8082 (uses the API on 3001)
```

Database changes live in `supabase/migrations/` (additive, idempotent):

```bash
SUPABASE_ACCESS_TOKEN=sbp_… node scripts/setup-supabase.mjs          # dry run
SUPABASE_ACCESS_TOKEN=sbp_… node scripts/setup-supabase.mjs --apply  # apply
```

## Test it

```bash
npx tsc --noEmit -p .                    # types
NETWORQ_SKIP_DOTENV=1 npm test           # unit + API + database (PGlite) tests
npm run build && npx playwright test     # end-to-end on desktop and phone layouts
```

See [docs/TEST_PLAN.md](docs/TEST_PLAN.md) for what each suite covers and the manual device checklist.

## Deploy

- **Web + API:** push to `main` → Render builds and deploys https://www.networq.co.in.
- **Database:** run the migration script above.

## Build the Android app

```bash
npm run build:apk     # EAS cloud build, "preview" profile → installable APK
```

The APK wraps the live site, so most changes reach phones without a new APK. Rebuild only when the shell (`App.native.tsx`, `app.json`, native permissions) changes.

---

## Documentation

| File | For | What's inside |
|---|---|---|
| [docs/PRD.md](docs/PRD.md) | Everyone | What we're building, for whom, every feature |
| [docs/PITCH.md](docs/PITCH.md) | Founders / sales | Client pitch, point by point |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | Whoever demos | A 7-minute live demo, step by step |
| [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) | Owner | What only the owner can do (keys, accounts, stores) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Engineers | How it's built: flows, endpoints, tables |
| [docs/DESIGN.md](docs/DESIGN.md) | Design / engineers | Information architecture, design system, motion |
| [docs/SECURITY.md](docs/SECURITY.md) | Engineers | Threat model and controls |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Engineers / QA | Automated suites + manual device checklist |
| [docs/QA_REPORT.md](docs/QA_REPORT.md) | Everyone | Latest release-gate results |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Engineers | Why things are the way they are |
| [CHANGELOG.md](CHANGELOG.md) | Everyone | What changed, release by release |
| [docs/PROJECT_HISTORY.md](docs/PROJECT_HISTORY.md) | Everyone | Contributors (Gemini/Antigravity, Claude), full timeline, current status |

---

© NetworQ 2026 · Private — all rights reserved
