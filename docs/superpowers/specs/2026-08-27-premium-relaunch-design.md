# NetworQ Premium Relaunch — Design Spec

Date: 2026-08-27
Status: Approved by user, ready for implementation planning

## Context

NetworQ is an Expo (React Native Web) single-page app (`App.tsx`) — a
business-card networking CRM. Backend is Supabase (auth, Postgres,
storage). AI features (card OCR, follow-up email drafting, chat
assistant) currently call Claude via a serverless proxy
(`api/claude.js` on Vercel, `server.js` for local dev). No `.env` file
exists yet in this checkout; no Supabase project, storage bucket, or
EmailJS template has been provisioned.

This spec bundles four independent workstreams the user asked to build
together and run in parallel: security hardening, Google Sign-In, a
full AI-provider swap (Claude → Groq), and a premium UI/UX redesign.
They are functionally independent of each other (none blocks another
at the code level) but touch overlapping files (`App.tsx`,
`supabase.ts`, `schema.sql`, the API proxy), so the implementation plan
should sequence file-level edits carefully even though the workstreams
themselves can be designed and built concurrently.

## 1. Security Hardening

**Problem:** `api/claude.js` / `server.js` currently accept requests
from any origin (`Access-Control-Allow-Origin: "*"`) with no
authentication, forwarding straight to the Anthropic key. The app's
daily AI-usage limit (`ai_usage` table, `increment_ai_usage` RPC) is
only invoked client-side, before the proxy call — a request that skips
the client and hits the proxy directly bypasses the limit entirely and
runs up the API bill.

**Design:**
- The proxy endpoint requires an `Authorization: Bearer <supabase_access_token>`
  header on every request.
- The proxy calls Supabase's `auth/v1/user` endpoint (or uses
  `supabase-js` configured with that token) to resolve the calling
  user. An invalid/missing/expired token → `401`.
- Before forwarding to the LLM, the proxy calls `increment_ai_usage`
  **using the caller's own token** (not a service-role key) so
  Postgres RLS (`auth.uid() = user_id`) enforces that a user can only
  increment their own counter — no elevated credentials needed on the
  server. If the RPC reports `allowed: false`, the proxy returns `429`
  with the existing limit-reached message instead of calling the LLM.
- CORS is locked to an explicit allow-list read from an
  `ALLOWED_ORIGIN` env var (comma-separated), defaulting to
  `http://localhost:8081,http://localhost:19006` for local dev. No
  wildcard in production.
- `schema.sql` gains the `card-images` Storage bucket (currently
  referenced by `App.tsx` but never created) plus per-user object
  policies scoped to the `${user_id}/...` path prefix already used by
  the upload code, so one user cannot read/overwrite another's card
  images even though the bucket is public-read for the emailed
  extracted URLs.
- Supabase Auth settings (dashboard config, not code): enable leaked
  -password protection, require email confirmation in production.
  Local/dev can leave confirmation off.

**Out of scope:** rate limiting infrastructure beyond the existing
Postgres-backed `ai_usage` table (no Redis/Upstash) — YAGNI, the
existing mechanism is sufficient once enforced server-side.

## 2. Google Sign-In

**Design:**
- Client calls `supabase.auth.signInWithOAuth({ provider: 'google',
  options: { redirectTo: <app origin> } })`. No custom OAuth code —
  Supabase's built-in provider handles the flow.
- `App.tsx`'s existing `onAuthStateChange`/session-check logic (in the
  mount effect) is extended: after a session appears, check whether a
  `profiles` row exists for that user. If not (first-time Google
  login — the manual signup flow never ran), show a short
  "complete your profile" step collecting company, role, sector, phone,
  linkedin, bio (the fields Google doesn't provide), then insert the
  `profiles` row and continue into the app — reusing the existing
  step-2 signup form fields/validation rather than building new ones.
- Email/password sign-in is **kept**, not replaced — Google becomes an
  additional option on the login/signup screens ("Continue with
  Google" button), not a replacement.
- **User-side prerequisite (not implementable by Claude):** a Google
  Cloud OAuth client must be created and its client ID/secret pasted
  into the Supabase Auth provider settings dashboard before this
  works end-to-end. The code changes are ready either way, but the
  feature is inert until that dashboard step is done.

## 3. AI Provider Swap — Claude → Groq (full replacement)

**Scope confirmed by user:** all three AI call sites move to Groq, not
just OCR — card-photo extraction, follow-up email drafting, and the
in-app chat assistant.

**Design:**
- `ANTHROPIC_API_KEY` is replaced by `GROQ_API_KEY` (server-side only,
  never in an `EXPO_PUBLIC_*` var).
- The proxy file (`api/claude.js` → renamed `api/ai.js`; `server.js`'s
  equivalent route updated to match) targets Groq's OpenAI-compatible
  endpoint (`https://api.groq.com/openai/v1/chat/completions`) instead
  of Anthropic's Messages API. This is a payload-shape change, not
  just a URL/model swap:
  - System prompt becomes a `{role: "system", content: ...}` message
    in the `messages` array, instead of Anthropic's separate `system`
    field.
  - Image content for card-OCR uses OpenAI's
    `{type: "image_url", image_url: {url: "data:<mime>;base64,<data>"}}`
    shape instead of Anthropic's `{type: "image", source: {type:
    "base64", ...}}`.
  - Response text is read from
    `choices[0].message.content` instead of `content[0].text`.
- Model selection: `meta-llama/llama-4-scout-17b-16e-instruct`
  (vision-capable, open-source) for card-photo extraction;
  `llama-3.3-70b-versatile` (open-source, fast) for email drafting and
  the chat assistant. Both are Groq-hosted, open-weight models,
  satisfying "any open source" from the request.
- Client-side functions in `App.tsx` (`callClaude`, `extractCard`)
  are renamed to provider-neutral names (`callAI`, `extractCard`
  unchanged in signature) and updated to build the new message/image
  shape and parse the new response shape. All call sites
  (`genIntroEmail`, `sendBotMessage`, `extractCard`) go through the
  same updated function, so there is exactly one place that knows the
  request/response format.
- User-visible behavior is unchanged: "click/upload a photo of a
  business card → form auto-fills" still works the same way; email
  drafts and chat replies still render the same way.

## 4. Premium UI/UX Redesign

**Theme — "Adaptive":** one glass design system, two modes:
- **Light ("Ivory Glass"):** soft lavender-to-peach gradient
  background, frosted white translucent panels (`rgba(255,255,255,0.55)`
  + `backdrop-filter: blur(16px)`), violet-to-peach accent gradient
  for avatars/highlights, dark text (`#1a1d23`).
- **Dark ("Midnight Glass"):** deep navy-indigo gradient background,
  frosted panels at low white opacity (`rgba(255,255,255,0.07)`) with
  a subtle border, indigo-to-cyan accent gradient, light text
  (`#f1f3fb`).
- A toggle (sun/moon icon in the nav) switches modes; the choice
  persists in `localStorage` and defaults to the OS
  `prefers-color-scheme` on first visit.

**Shell — "Floating Top Bar":** a pill-shaped, frosted-glass navbar
(replacing the current plain tab row) containing the logo, nav tabs,
search, and profile/theme-toggle controls. Chosen over a sidebar or
bottom-dock layout because it requires the least structural rework of
the existing single-page layout while still reading as premium.

**Applied across every screen:**
- Splash, login, and signup screens: centered glass card over the
  gradient background (replacing today's plain white card on flat
  `#f4f6fb`).
- Main app: glass navbar (above); contact list as frosted glass cards
  in grid view and glass-row styling in table view (both view modes
  already exist in the code and are kept, just restyled); modals
  (add/edit contact, email draft, meeting scheduler, profile) as
  centered glass panels over a blurred backdrop instead of plain white
  boxes; the AI chat assistant as a floating glass panel.
- This is a full rewrite of the `S` style constants object and the
  injected `CSS` template string in `App.tsx`, plus the theme-toggle
  state and `localStorage` persistence. It is **not** a framework
  migration — no Tailwind, no shadcn/ui, no move to Next.js. Existing
  component structure, state, and data flow are unchanged; only
  presentation changes.

## 5. Production-Readiness Gaps

Concrete items, not deferred:
- `.env.example` documenting every required variable:
  `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
  `GROQ_API_KEY`, `EXPO_PUBLIC_EMAILJS_SERVICE_ID`,
  `EXPO_PUBLIC_EMAILJS_TEMPLATE_ID`, `EXPO_PUBLIC_EMAILJS_PUBLIC_KEY`,
  `EXPO_PUBLIC_GOOGLE_CLIENT_ID` (optional, Calendar only),
  `ALLOWED_ORIGIN`.
- Written setup steps for provisioning: run `schema.sql` (including
  the new storage bucket/policies from §1), create the EmailJS
  template with the exact variable names the code sends (`to_email`,
  `to_name`, `from_name`, `reply_to`, `subject`, `message`), set env
  vars in Vercel project settings.
- **Password reset:** "Forgot password?" link on the login screen →
  `supabase.auth.resetPasswordForEmail` → a reset-password screen that
  handles Supabase's recovery-token redirect and calls
  `supabase.auth.updateUser({ password })`.
- **Enforced email verification:** with Supabase's "confirm email"
  setting on in production, `handleSignup` must handle the case where
  `signUp` succeeds but returns no active session (pending
  confirmation) by showing a "check your email" screen instead of
  assuming immediate login; `handleLogin` must surface Supabase's
  "Email not confirmed" error distinctly from "invalid credentials".

**Explicitly out of scope for this pass:** two-factor authentication.
It's a separable feature with its own UX; not part of this spec. Can
be scoped separately if wanted later.

**Deferred, not guessed at now:** the open-ended "app features" ask.
Once the above is built, a short audit of the running app will be
brought back as a concrete pick-list rather than speculated here.

## Testing / Verification

- Security: a request to the AI proxy with no/invalid token is
  rejected (401); a user who has exhausted their daily quota is
  rejected (429) even when calling the proxy directly (curl), not just
  through the UI.
- Google Sign-In: a new Google user reaches the profile-completion
  step exactly once; an existing Google user with a profile goes
  straight to the app.
- AI swap: card-photo extraction, email drafting, and chat all produce
  correctly-shaped results against the new Groq models; no remaining
  reference to `ANTHROPIC_API_KEY` or `api/claude.js` anywhere in the
  codebase.
- UI: both theme modes render correctly on every screen; the
  toggle persists across reloads; existing functionality (contact
  CRUD, scanning, CSV export, reminders) is unchanged behaviorally.
- Password reset and email-confirmation flows are exercised manually
  end-to-end against a real Supabase project.

## Non-Goals

- No migration off Expo/React Native Web.
- No migration to Tailwind/shadcn/Next.js.
- No 2FA in this pass.
- No new backend (Supabase and its existing schema stay; only additive
  changes — storage bucket, none of the existing tables change shape).
