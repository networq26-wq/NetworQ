# Changelog

## 2026-10-09 (evening) — NetworQ Admin

### New
- **Admin panel** at `https://www.networq.co.in/waitlist/admin`: Admin ID + password, light CRM design with the official logo.
  - **Overview:** totals, today, last 7 days with growth, waiting / invited / joined the app, a 30-day chart, sources, latest sign-ups.
  - **Sign-ups:** search, filters (dates, status, source, tag), 50 per page; bulk invite, resend, tag, delete; "invite the next N" (most referrals first); CSV export that follows the filters.
  - **Person page:** every detail, the people they brought in, notes and tags.
  - **Reports:** sources, campaigns, company vs personal emails, top referrers, devices, time zones, email health with "Retry failed".
  - **App:** users, active users, contacts, messages, calls, events, AI use.
  - **Health:** server errors and email problems since the last restart.
  - **Activity log**, and **Admins** (the owner adds or disables admins).
- Sign-ups record their source (UTM tags or the page they came from), referral code, device and time zone. Each person's share button shares their own invite link.
- The invite email links to the app and the Android download. The website APK download is updated to today's build.
- **Database:** `supabase/migrations/20261020_waitlist_admin.sql` (additive). Run it once in the Supabase SQL editor.

## 2026-10-09 — Waitlist site live, links & files in the Android app

### Fixed
- **waitlist.networq.co.in** was down (Cloudflare error 1001 / no HTTPS certificate): the custom domain on the Cloudflare Pages project `networq-waitlist` was stuck at "CNAME not set". Re-validated; HTTPS works and http redirects to https.
- The subdomain now serves the **full landing page** (`landing/`: hero, problem, solution, features, recall, why, waitlist, footer) instead of the one-screen sign-up page. Published as static files: `vite build` in `landing/`, render `/` once with `wrangler dev`, deploy `index.html` plus `.output/public` with `wrangler pages deploy --project-name networq-waitlist`. **Don't redeploy `waitlist-deploy/` to that project**: it would replace the full page with the simple one.
- Waitlist forms hosted off Render (the Cloudflare page and the landing site) call `https://www.networq.co.in/api/waitlist/join` (CORS allowed), so the confirmation email goes out immediately. After 8 s they fall back to Supabase directly.
- **Android app:** `window.open` and `target=_blank` links did nothing (chat files, event pages, WhatsApp, prospect sources, settings links, mailto). In the app they now navigate, and the shell opens other sites in the phone's apps. Works in the installed app. The new APK also opens chat photos/files in the phone's own viewer.
- Removed hand-written `declarations.d.ts` (it shadowed the real expo-local-authentication / expo-secure-store types).

## 2026-10-07 — Group calls & attachments

### New
- **Group calls** — voice or video with up to 6 people (you + 5 connections). People → Select → *Call N*; everyone rings (in the app or by push), joins, and sees everyone in a video grid; mute / camera / leave; the call ends when everyone has left. Peer-to-peer mesh — no media on our servers.
- **Photos & files in chat** — 📎 in private chats: photos (shrunk automatically for mobile data), PDF, Office docs, text/CSV, zip up to 10 MB; previews, full-screen photos, file cards; private storage only the two people can open.
- Antigravity's Radar rings (2/5/10/20 m) and frosted bottom bar — reviewed and fixed (dots aligned to rings, no crash before layout).
- **Waitlist confirmation email + admin dashboard** (Antigravity) — reviewed and secured: the dashboard (`/api/waitlist/dashboard`) and CSV export were public; they now need `WAITLIST_ADMIN_PASSWORD` (set on Render; off until then). No duplicate emails, only recent sign-ups are emailed, safe CSV for Google Sheets, sign-ups rate limited.
- Home "Coming up" strip removed (Antigravity, 4d3a4dc).


## 2026-10-05 (afternoon) — "Every user, every device" release

### New
- **App lock** — fingerprint / face with the phone's PIN, pattern or password as the passcode (like Google's apps); Lock after Immediately / 1 min / 5 min (Android app).
- **Google Calendar & Meet for every user** — connect once (in the phone's browser in the app); NetworQ then creates Meet invites from the server; Google emails Accept/Decline. Works on web and in the Android app.
- **Google sign-in on networq.co.in** — Google now shows "continue to networq.co.in" instead of the Supabase address (NetworQ name + logo after Google's branding review). Older app versions fall back automatically.
- **Set-password email** — Google-only accounts get one "Set a password" email so they can also sign in with email.
- **ElevenLabs voice** for the AI assistant (natural voice), Groq voice as fallback.
- **Events hero** — auto-scrolling featured events (BookMyShow/District style), swipeable, India-first.
- **Card** — circuit-trace network design, drawn by exact geometry, with signal pulses.
- **Always-current app** — refreshes itself to the newest build when reopened.

### Fixed
- Profile photo upload ("new row violates row-level security") and re-picking a photo.
- Back button: browser-history safety net (phone back gesture); no stale steps after reload/sign-out.
- Sign-in screens no longer slide under the status bar.
- Scrollbar lines removed from sideways strips; product-style search bars; one-tap meetings (tomorrow 10:00 pre-filled).
- "Share" on the profile is now "Share card".


## 2026-10-05 — "Talk to your people" release

### New
- **Voice & video calls (1:1)** that ring on any screen and by push when the app is closed; accept/decline, mute, camera, flip; missed/declined in the bell; optional TURN relay.
- **Messages:** inbox, *New message* contact picker (chat/call people on NetworQ, invite everyone else), live chat with typing and read receipts, push notifications.
- **Voice note rebuilt:** record → Whisper transcription → AI-extracted details you review → saved with a reminder on the day you said. The AI assistant's mic uses the same engine (now works in the Android app).
- **People home:** live greeting line, at-a-glance strip, round quick actions, *Who's next*, *Coming up* (this week's events in your city), Select mode with bulk email / message.
- **Events redesign:** search with a location sheet, All/Today/Weekend/This week + month calendar, day-grouped results, card-style events with *Going*.
- **Your card:** premium credit-card design with the official logo and your photo; QR on the back.
- **Me:** one entry (header avatar); settings split into simple sub-pages.
- **Official logo everywhere** (app + website) with the Q scan beam in brand violets.
- **Meetings:** Google Meet / pasted link / Jitsi with a real calendar invite (Accept/Decline).
- **Push notifications** on Android (Expo/FCM) and browsers (Web Push).
- **AI prospect research** with fact-checked drafts and sources.
- **Nearby Radar** (Bluetooth, rotating IDs, no location) alongside Event Radar.

### Fixed
- Back button now steps back screen by screen everywhere and exits only from home (app + Android shell).
- Voice notes were silently discarded (wrong address, non-existent columns) — now saved correctly with reminders.
- Calls screen could be covered by the chat window — calls now sit above everything.
- Follow-ups: no "sent" mark if the save failed; large batches paced under the email limit.
- AI copilot in the local preview pointed at the wrong server.
- Events stored as date-only now read "All day" instead of a fake 5:30 AM.
- Radar: one clear message per state, no duplicate intro cards, aligned buttons.
- 18 misaligned badges/pills; alignment across lists, sheets and toolbars.
- Leftover Android build files that broke clean EAS builds.

### Security
- Calls and messages written only through checked database functions (connected + unblocked, rate-limited); private realtime channels.
- Speech-to-text and TURN endpoints require a signed-in user; rate limits before routes.
