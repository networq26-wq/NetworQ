# QA Report — NetworQ

**Date:** 2026-10-01 (two passes)  **Scope:** web app, Express API, Supabase data layer, Android WebView shell

## Verdict: CONDITIONAL GO

The code is release-ready: every automated check passes. Three configuration steps outside the repo must be done before launch (see "Required before launch").

| Area | Result | Evidence |
|---|---|---|
| Type check | ✅ 0 errors (was 7) | `npx tsc --noEmit` |
| Unit + API + security tests | ✅ 40 / 40 | `npm test` |
| Production build | ✅ | `npm run build` |
| Browser E2E (desktop + Pixel 7), CSP enforced | ✅ 49 / 49, 0 CSP violations | `npm run test:e2e` |
| Live Supabase RLS | ⚠️ 13 / 14 (passes after migration) | `npm run test:rls` |
| Secrets in bundle | ✅ none | grep of `dist/_expo/static/js/web/*.js` |
| Dependency audit (prod) | ⚠️ 10 (build-time only, not in server runtime) — was 27 | `npm audit --omit=dev` |

## Required before launch (owner action)

1. **Run both migrations in the Supabase SQL editor**, in order:
   - `supabase/migrations/20261001_security_hardening.sql`
   - `supabase/migrations/20261001b_restore_waitlist_and_storage.sql` (the live project is missing `join_waitlist()` and the `card-images` bucket)

   Then re-run `npm run test:rls` (expect 14 / 14).
2. **Verify a sending domain in Resend** (e.g. `networq.co.in`) and set `RESEND_FROM_EMAIL=NetworQ <noreply@networq.co.in>`. The current `onboarding@resend.dev` sandbox only delivers to the Resend account owner.
3. **Rebuild the Android APK** (`npm run build:apk`). The OTA update URL now points at the current EAS project (`48b3a694…`), so APKs built earlier cannot receive updates.

## Defects found and fixed

| # | Sev | Defect | Fix |
|---|---|---|---|
| 1 | P0 | Returning users were logged out on every reload. `onAuthStateChange` awaited Supabase queries while supabase-js held its auth lock, so `getSession()` deadlocked. The earlier "splash stuck at 92%" timeout only masked it. | Callback no longer awaits; loads are deferred and de-duplicated (`App.tsx`) |
| 2 | P0 | Dev tokens (`mock-*`, `local-dev-token`) were accepted in production, so anyone could send email or use paid AI | Rejected when `NODE_ENV=production` (`api/_lib/verifyAndLimit.js`) |
| 3 | P0 | `/api/ai` worked with no token at all | Valid session required (`api/ai.js`) |
| 4 | P0 | Users could reset their own AI quota (live-confirmed); the RPC trusted a caller-supplied user id | Migration: drop update/insert policies, bind RPC to `auth.uid()` |
| 5 | P0 | SSRF: `/api/enrich` fetched internal/metadata IPs and followed unlimited redirects | Public-IP check on every hop, max 3 redirects (`api/enrich.js`) |
| 6 | P0 | Card Scanner screen crashed (`Icons.Camera` undefined) | Added the icon |
| 7 | P1 | Emails were sent from the browser through EmailJS with unset keys, so nothing was sent. Bulk send still marked everyone "sent". | All email now goes through the authenticated `/api/email`; failures are reported and retryable |
| 8 | P1 | Resend sender parsing fell back to an unverified address whenever a sender name was set | Uses the configured address |
| 9 | P1 | Meeting links were random fake `meet.google.com` codes | Real Jitsi Meet rooms; Google Calendar invite with automatic fallback |
| 10 | P1 | Signup with email confirmation lost name/company | Stored in user metadata; profile auto-created on first login |
| 11 | P1 | Delete / reminder toggle showed success even when the DB write failed | Errors surfaced; UI state unchanged |
| 12 | P1 | One-tap permanent delete | Two-tap confirm |
| 13 | P1 | Signup step 1 silently ignored missing or invalid input | Inline validation (required fields, email format, 8+ char password) |
| 14 | P1 | Google OAuth is blocked inside the Android WebView (`disallowed_useragent`) | Google button hidden in the native shell; email login works |
| 15 | P1 | `mailto:` / `tel:` links broke inside the APK | Handed to the OS |
| 16 | P1 | `app.json` lost its OTA config while CI still ran `eas update`; manifest pointed at the old EAS project | Restored for the current project |
| 17 | P2 | HTML injection in reminder emails | Escaped |
| 18 | P2 | `/api/email` accepted lists / malformed recipients | Single validated address, size limits, 50/day cap |
| 19 | P2 | Production bound 3 ports; `compression` not declared | Single `$PORT`; dependency declared |
| 20 | P2 | Icon-only buttons had no accessible name | `aria-label`s added |
| 21 | P2 | Native shell failed type-check | Typed WebView refs and events |

### Second pass (2026-10-01) — audit methods from external skill packs

Checklists used: `levnikolaevich/claude-code-skills` (codebase, test-suite and persistence auditors) and `zhaoxuya520/reverse-skill` (API security, supply chain, JS bundle review). Only methodology was applied; no third-party tools or scripts were run.

| # | Sev | Defect | Fix |
|---|---|---|---|
| 22 | P1 | Live DB is missing `join_waitlist()`, so every waitlist sign-up fails | Migration `20261001b` |
| 23 | P1 | Live project has no storage buckets; card photos are saved as ~2.7 MB data URLs in `contacts.image` and downloaded on every login | Migration creates the bucket; photos are downscaled to ≤1280px JPEG before upload or storage |
| 24 | P1 | Digital Pass sent the user's name, email and company to `api.qrserver.com` | QR generated on-device (`qrcode`) |
| 25 | P1 | Storage policy let anyone list every user's card images | Owner-only listing |
| 26 | P2 | No security headers (clickjacking, HSTS, nosniff); X-Powered-By exposed | `helmet` + strict CSP on the app, verified by E2E |
| 27 | P2 | No per-IP rate limit on public endpoints | `express-rate-limit` (enrich 30/min, AI 60/min, email 20/min) |
| 28 | P2 | 5xx responses leaked internal error messages | Generic message in production |
| 29 | P2 | QR import spread untrusted JSON into the form; used `alert()` | Field whitelist, toasts |
| 30 | P2 | Waitlist table allowed direct anonymous inserts, bypassing validation | Insert policy removed; RPC only |
| 31 | P3 | Container ran as root; no graceful shutdown; unused `@emailjs/browser` | `USER node`, SIGTERM drain, dependency removed |

## Test assets

- `tests/api/` — hermetic HTTP and security tests (auth bypass, open relay, SSRF, CORS, XSS escaping).
- `tests/e2e/` — Playwright against the production build, with an in-memory Supabase mock that emulates RLS. Covers signup (including the confirmation flow), login errors, session persistence, logout, account switching, two simultaneous users, add/edit/delete with failure injection, every main screen, 5 viewports, and email routing.
- `tests/integration/supabase-rls.test.js` — opt-in live tenant-isolation test. It creates and deletes two throwaway users.
- `.claude/agents/` — `qa-lead`, `qa-e2e-tester`, `qa-api-security-tester`, `qa-mobile-release-tester`.

## Not tested (and why)

- Real email delivery: needs the verified Resend domain (item 2).
- Real Groq AI responses: AI is mocked in E2E to avoid billed calls. Auth on the route is tested.
- APK on a physical device / emulator: no Android emulator in this environment. Config and shell code are reviewed and type-checked.
- Google OAuth end to end: needs a real Google account in a browser.

## Reproduce

```bash
npm run test:all     # tsc + unit/API + build + E2E
npm run test:rls     # live RLS (creates/deletes 2 temp users)
```
