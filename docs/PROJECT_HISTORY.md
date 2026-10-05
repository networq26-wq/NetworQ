# NetworQ — project history, contributors and timeline

*From the first commit (27 Aug 2026) to the current release (5 Oct 2026). 107 commits on `main`.*

## Who built what

| Contributor | Commits | Main areas |
|---|---|---|
| **Gemini / Antigravity** (with the owner) | 49 | V1 backend & deployment, PWA, Android WebView shell, branding/logo passes, splash & loading, master product spec (batch scanner, contextual pass, network map, introductions, day summary, global search), first chat / WebRTC audio / AI copilot personas / voice debrief, safe-area system, **waitlist landing site** (`landing/`, `public/waitlist.html`), website branding and mobile layout |
| **Claude (Claude Code)** | 58 | Production QA & security hardening, Event Radar + Nearby (BLE), accounts & emails, settings, real events engine, Google sign-in, notifications & push, AI prospect research, scanner, digital card, motion & design system, new app structure (People · Messages · Radar · Events · Me), meetings & calendar invites, **voice & video calls**, voice notes (Whisper), back-button navigation, Events redesign, Google Calendar for every user, ElevenLabs voice, release gates, documentation |

Work happened in parallel on separate branches and was merged into `main` at sync points (4 Oct 00:33, 4 Oct evening, 5 Oct 09:36 and 10:20). Commits by Claude carry a `Co-Authored-By: Claude` trailer; everything else is Gemini/Antigravity or the owner.

---

## Timeline

### Phase 0 — Baseline · 27 Aug 2026
- Initial commit of the pre-relaunch app and the premium relaunch design spec. *(Gemini/owner)*

### Phase 1 — V1 goes live · 29 Sep 2026 (20 commits, Gemini/Antigravity)
- Full backend (Express), email via Resend, reminders, deployment configs (Koyeb/Render/Docker), project docs.
- Production domain **networq.co.in** whitelisted; Render secret files loaded.
- Removed fake contacts for new users; dynamic KPIs (no hard-coded stats).
- PWA installability; EAS project linked (`networ-q`), OTA updates config.
- Several logo/favicon passes from the Brand Identity PDF.
- AI voice: Groq JSON routing fixes, "Jarvis/Siri" voice persona (device speech).

### Phase 2 — Android app · 30 Sep 2026 (9 commits, Gemini/Antigravity)
- APK download endpoint, version API, auto-release workflow.
- **Native Android WebView shell** with camera & microphone permissions.
- Radar auto-detection, unified AI assistant, camera card scanner fixes.
- Splash/loading: 600 ms splash, compression, immutable caching, progress bar, fix for a splash freeze at 92 %.

### Phase 3 — Production hardening & core features · 1 Oct 2026 (18 commits, Claude)
- Production-readiness QA: auth deadlock fix, security headers, rate limits, real email, first E2E suite.
- **Event Radar**: database schema + RPCs (tested on PGlite), proximity engine, BLE discovery, live radar UI, consent-based contact exchange.
- Privacy / terms / delete-account pages; welcome, new-sign-in, password-changed and deletion emails.
- Settings: profile photo, password/email change, sign out everywhere, delete account.
- **Real events only**: import from event pages and `.ics` feeds; NetworQBot keeps Events filled (India + worldwide).
- Node 22 on Render; Google sign-in in the Android app; set-password email for Google users; card OCR, back button, camera permission.

### Phase 4 — Feature depth · 3 Oct 2026 (13 commits: 12 Claude, 1 Gemini)
- Device preview with Fast Refresh and two-user QA.
- Natural assistant voice (Groq Orpheus) with device fallback.
- Realtime connections, notification centre, blocking, connection emails.
- Scanner reduced to Scan + Upload with an iOS-style camera.
- **AI prospect research** with fact-checked email drafts and sources.
- **Nearby** radar (Bluetooth, no event needed).
- Events categories, de-duplication, filters, more sources.
- Wallet-style digital pass with a vCard QR; settings extras (blocked people, devices, help).
- *(Gemini)* Master product specification: batch scanner, contextual pass, network map, introductions, day summary, global search, safe areas.

### Phase 5 — Messaging, push, design system, new structure · 4 Oct 2026 (31 commits: 18 Gemini, 13 Claude)
- *(Gemini)* Global safe-area system; google-services.json for EAS.
- *(Claude)* **Push notifications** — Android (Expo → FCM) and browsers (Web Push), free.
- *(Gemini/Antigravity)* Live radar canvas, voice debrief, **in-app realtime chat, WebRTC audio meet**, AI copilot personas.
- *(Gemini)* **Waitlist landing site**, illuminated logo, waitlist registration; royal-violet branding passes; real conference photo; "Never lose a conversation again" tagline; luxury pill waitlist form; mobile layout.
- *(Claude)* Motion system, one icon set, skeletons, honest data, liquid-glass bottom bar; chat hardened (RLS, private channels, rate limits).
- *(Claude)* **Meetings**: Google Meet / pasted link / Jitsi with real calendar invites.
- *(Claude)* **New app structure**: People · Messages · Radar · Events, Me behind the avatar, quiet AI button, home quick actions.
- *(Claude)* Calmer People home, Who's next, select & bulk email/message, official logo everywhere (app + website), QA fixes.

### Phase 6 — "Talk to your people" release · 5 Oct 2026 (14 commits, Claude)
- **Voice & video calls (1:1)** that ring anywhere and by push; TURN-ready.
- **Back button** that steps back everywhere (app + shell + browser history).
- **Voice notes & AI mic** rebuilt on Whisper (worked in no Android app before).
- New-message picker; card with logo + photo; Radar decluttered; **Events redesign**; Coming up on home.
- Two QA agents' release gate → security & functional fixes (hooks never throttled, voice cap, strict CORS, per-user TURN, locked call helpers, mic release, safer shell).
- Always-current app (auto-refresh), photo upload fix (storage policy), **ElevenLabs** voice, circuit-trace card, product search style, one-tap meetings.
- **Google Calendar & Meet for every user** (web + app), **Google sign-in on networq.co.in**, set-password email for Google accounts, events hero carousel, safe-area sign-in.
- Merged Gemini's website/waitlist work (5 Oct 09:36) into the release.

---

## Where things stand (5 Oct 2026)

| Area | Status |
|---|---|
| Web app — https://www.networq.co.in | ✅ Live (Render, auto-deploy from `main`) |
| Android app | ✅ APK built 5 Oct 13:33 (`~/Desktop/NetworQ.apk`); auto-updates content |
| Database | ✅ Migrations `20261001 … 20261017` applied in production |
| Website / waitlist | ✅ Merged into `main`; `landing/` site deploy target to confirm |
| Tests | ✅ 184 backend/DB tests; ~150 E2E (desktop + phone); live two-browser call/voice/meeting checks |
| Google verification | ⏳ Domain verified 5 Oct; branding re-review + calendar-scope verification pending (2–3 working days) |

## Key numbers
- **Commits:** 107 (49 Gemini/owner · 58 Claude) over 40 days; 95 % of the work in the last 7 days (29 Sep – 5 Oct).
- **Migrations:** 17 database migrations, all additive.
- **Server endpoints:** 25+ (AI, transcribe, TTS, email, prospect research, events import, calls/ICE, Google calendar & sign-in, push, notification hook, account).
- **Automated tests:** 184 backend/database + ~165 browser scenarios.
