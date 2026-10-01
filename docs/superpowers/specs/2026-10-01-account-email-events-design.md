# Account, Email, Events & Store-Readiness — Design

**Date:** 2026-10-01  **Status:** Approved scope (owner chose A + B + C + D)

References studied: `lukevella/rallly` (settings: profile / security / notifications; emails: register, reset-password, change-email, password-added, account-deletion-scheduled), `wasp-lang/open-saas` (auth email flows), `resend/react-email` (email layout patterns).

## D. Store basics

- `public/privacy.html`, `public/terms.html`, `public/delete-account.html`, served at `/privacy`, `/terms`, `/delete-account`.
- The content describes NetworQ's actual data handling:
  - Supabase stores data.
  - Groq processes card images and AI chat.
  - Resend sends email.
  - Radar broadcasts rotating anonymous BLE tokens; no location is collected.
- The pages are marked for legal review.
- Linked from the login screen footer and from Settings.

## A. Settings & security (`settings/SettingsScreen.tsx`)

Opened from the existing profile and gear entry points; it replaces the profile modal.

| Section | Contents |
|---|---|
| Profile | Name, company, role, sector, phone, LinkedIn, pitch, **photo** (downscaled to 512 px, stored at `avatars/{uid}/avatar.jpg`, saved as `profiles.avatar_url`) |
| Security | **Change password** (re-verify the current password, then `updateUser`; min 8 chars), **change email** (Supabase secure email change, confirmed from both inboxes), **sign out of all devices** (`signOut({ scope: "global" })`) |
| Notifications | `profiles.notification_prefs`: `login_alerts`, `reminder_emails`, `product_updates` |
| Your data | Export contacts (CSV, existing); privacy / terms links |
| Delete account | Type DELETE to confirm → `POST /api/account/delete` schedules deletion 7 days out (`profiles.deletion_scheduled_at`), emails a confirmation, signs out everywhere. Signing in during the grace period shows a banner with **Cancel deletion** (`POST /api/account/cancel-deletion`). The hourly server job purges due accounts with `auth.admin.deleteUser` (cascades). |

- **Show/hide password** toggle on every password field.

## B. Professional emails (`api/_lib/emails/`)

- Templates built with `@react-email/components` + `render` (no JSX build step; `React.createElement`). Shared layout: preheader, logo, single CTA, footer with a notification-settings link, plain-text version.
- **Sent by our server through Resend:**
  - **Welcome:** first `signed_in` event for a user.
  - **New sign-in:** a `signed_in` event from an unseen device fingerprint, when `login_alerts` is on. Shows device, browser and time, plus a city if the host provides a geo header. CTA "Secure my account" uses an HMAC-signed 24 h link → `GET /api/account/secure?t=` revokes all sessions (`revoke_all_sessions` RPC, service role) and sends a password-reset email.
  - **Password changed:** the client reports it after a successful `updateUser`; the server verifies the JWT, then sends.
  - **Account deletion scheduled:** includes a cancel link.
- **Endpoint:** `POST /api/auth/session-event {type: "signed_in" | "password_changed"}` (JWT required, rate-limited).
- **Table** `login_devices(user_id, device_hash, user_agent, first_seen, last_seen)`.
- **Sent by Supabase (branded):** `supabase/templates/{confirm-signup,reset-password,change-email,magic-link}.html` using Supabase template variables, plus setup steps for custom SMTP through Resend. Without custom SMTP, Supabase only delivers to team members.

## C. Honest events

- Remove the AI "live scraper" (it invented events) and the unverified hard-coded `DEFAULT_EVENTS`.
- New table `public_events(id, title, starts_at, ends_at, venue, city, url unique, source_host, image, description, organizer, created_by, verified, created_at)`.
  - Readable by authenticated users.
  - Rows are written only by the server after extracting data from a real source page.
- `POST /api/events/import {url}` (auth, SSRF-guarded, rate-limited):
  - Event page → schema.org `Event` JSON-LD (Luma, Eventbrite, Meetup and Townscript all publish it).
  - `.ics` calendar feed → future `VEVENT`s, at most 50, parsed with `node-ical`.
  - Upserts by URL; returns the events.
- **Events Hub:** upcoming `public_events` with search and city filter. Each card shows the source host, an "Open event page" link, and "I'm attending · Radar" (`join_listed_event` with `external_id = public_events.id`). The empty state invites pasting an event or calendar link. A **Verified** badge appears when `verified = true`, set by an admin.

## Migration

`supabase/migrations/20261003_account_email_events.sql`:
- `profiles.avatar_url`, `notification_prefs jsonb`, `deletion_scheduled_at`
- `login_devices`, `public_events` (+ RLS)
- `avatars` bucket + owner-write policies
- `revoke_all_sessions(uuid)` (service role only)

## Testing

- **PGlite:** RLS and function rules for the new tables and functions.
- **API (hermetic):**
  - session-event auth, device dedupe, welcome-once
  - signed secure-link verify / expiry / tamper
  - delete / cancel auth
  - import: JSON-LD + ICS parsing from fixtures, SSRF refusal, no fabricated fields
- **Email:** every template renders HTML + text, includes its CTA, escapes user input.
- **E2E:**
  - settings change password (wrong current password refused)
  - show/hide password
  - sign out all
  - delete → banner → cancel
  - notification toggles persist
  - Events Hub empty state → import link → card with source → I'm attending
  - privacy / terms / delete-account pages load
