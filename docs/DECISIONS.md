# Architecture Decisions — NetworQ

## ADR-001 — Single File Frontend (App.tsx)
**Decision:** Keep entire React frontend in one file (`App.tsx`)

**Reason:** The project started as a rapid prototype. A single file allows fast iteration without import resolution complexity. Refactoring into separate files is planned for V2 once the feature set stabilizes.

**Trade-off:** File is large (~8500 lines). Mitigated by clear section comments.

---

## ADR-002 — Groq over OpenAI
**Decision:** Use Groq API for all AI features

**Reason:** Groq offers significantly faster inference (100–300 tokens/sec vs OpenAI's 40–60). Speed matters for real-time chat and card scanning. Groq's free tier is generous for MVP.

**Models:**
- Vision (card scan): `meta-llama/llama-4-scout-17b-16e-instruct`
- Text (chat, email): `qwen/qwen3.8-27b`

---

## ADR-003 — Express.js serves both frontend and backend
**Decision:** `server.js` serves the built React app AND handles all API routes

**Reason:** Simplifies deployment — one process, one port, one URL. No CORS issues between frontend and backend since they share the same origin in production.

**Trade-off:** Frontend and backend are tightly coupled for deployment. Acceptable for V1.

---

## ADR-004 — Resend over EmailJS / Gmail SMTP
**Decision:** Use Resend HTTP API for email sending

**Reason:**
- EmailJS requires client-side keys (exposed in browser)
- Gmail App Passwords unavailable on Google Workspace accounts
- Resend is server-side, free (3k/month), simple HTTP API, no npm package needed

---

## ADR-005 — Supabase over Firebase
**Decision:** Use Supabase for auth + database

**Reason:** Supabase uses PostgreSQL (standard SQL), has better pricing, open source, and provides both auth and database. Row Level Security is built-in. Firebase's Firestore has a document model that doesn't fit relational contact data well.

---

## ADR-006 — Fly.io over Railway/Vercel/Render for production
**Decision:** Deploy to Fly.io

**Reason:**
- Railway: paid from day one (~\$5/month minimum)
- Render: free tier sleeps after 15 min (breaks reminder engine)
- Vercel: frontend only, can't run persistent Node.js (no setInterval)
- Fly.io: free tier, never sleeps, Bangalore region, Docker-based = reproducible

---

## ADR-007 — Browser Notifications over Push Notifications (V1)
**Decision:** Use Web Notifications API for event reminders in V1

**Reason:** Push notifications require a service worker, VAPID keys, and mobile app setup. Browser notifications work immediately with no infrastructure. Server-side reminders handle the persistent case via email.

**V2 Plan:** Add Expo Push Notifications for mobile app.

---

## ADR-008 — Inline styles over Tailwind CSS
**Decision:** Use inline React styles instead of Tailwind CSS

**Reason:** The app started with inline styles for rapid prototyping. The theming system (dark/light mode via `themeStyles` object) is already built. Migrating to Tailwind would require significant refactor with no functional benefit in V1.

---

## ADR-009 — No Redux / Zustand
**Decision:** Use React `useState` and `useCallback` for all state

**Reason:** The app has a single root component with all state at the top level. Props are passed down. This is sufficient for V1 complexity. Adding a state library would add overhead without benefit.

---

## ADR-010 — nodemailer kept as SMTP fallback
**Decision:** Keep nodemailer in the email handler as fallback

**Reason:** Some deployments may have corporate SMTP servers. nodemailer allows Resend → SMTP → dev-log fallback chain without breaking changes.

---

## ADR-011 — Render (supersedes ADR-006)
**Decision:** Production runs on Render, auto-deploying `main` to https://www.networq.co.in.
**Reason:** one-push deploys from GitHub, managed TLS and env vars, persistent Node process for jobs and webhooks. Fly.io/Surge configs are legacy.

## ADR-012 — Android app as a WebView shell
**Decision:** The Android app is an Expo shell that loads the live site and exposes native features (camera, microphone, Bluetooth radar, push, back button, Google sign-in) through bridges.
**Reason:** one product to build and test; most releases reach phones instantly. Trade-off: shell changes need a new APK.

## ADR-013 — Database-enforced social features
**Decision:** Connections, messages, calls, blocking and radar are written only through security-definer RPCs; tables deny direct writes.
**Reason:** the client is untrusted; rules like "only connected, unblocked people can message or call" must hold even with a modified app.

## ADR-014 — Push for free: Expo Push + Web Push
**Decision:** Expo Push (FCM V1 under the hood) for Android, Web Push (VAPID) for browsers — no paid push service. (Supersedes ADR-007.)

## ADR-015 — WebRTC calls with Supabase Realtime signalling
**Decision:** 1:1 calls are peer-to-peer WebRTC; ringing is a `calls` row (Realtime + push), signalling on the private `call:` channel; TURN optional via `/api/calls/ice`.
**Reason:** no per-minute call costs; privacy (media never on our servers). Group calls will use an SFU (Jitsi/LiveKit) later.

## ADR-016 — Server-side speech recognition (Whisper)
**Decision:** Voice features record audio (MediaRecorder) and transcribe on the server with Whisper.
**Reason:** browser speech recognition doesn't exist in Android WebViews and handles Indian English poorly; Whisper works everywhere and is free on Groq.

## ADR-017 — Honest AI
**Decision:** No canned or fabricated AI responses. If the model is busy, say so (503); extraction returns empty fields rather than guesses; research drafts are fact-checked against sources.

## ADR-018 — Information architecture: four tabs + Me
**Decision:** People · Messages · Radar · Events in the bottom bar; Me (card + settings) behind the header avatar; scan/type/voice/QR/follow-ups as home quick actions; AI as a quiet floating button.
**Reason:** fewer, clearer destinations (the "2-year-old / 80-year-old" test); one way to reach each thing.

## ADR-019 — Official brand artwork only
**Decision:** The logo is the official artwork (`public/brand/*.png`, cropped and background-removed with pixel-exact colours); only the scan beam is animated in CSS.
