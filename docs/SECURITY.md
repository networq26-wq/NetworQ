# Security — NetworQ

## Principles
1. **The database enforces access, not the UI.** Every table has RLS; anything that touches another person (connect, message, call, block, radar) goes through a `security definer` RPC with `set search_path = public` that checks *who you are, whether you're connected, and whether either side has blocked the other*.
2. **Secrets stay on the server.** The app only ever has the Supabase URL + anon key and public IDs.
3. **No fake success.** Errors are shown honestly; nothing pretends to have been sent or saved.

## Secrets
| Secret | Where | In the app bundle? |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `RESEND_API_KEY`, `VAPID_PRIVATE_KEY`, `EXPO_ACCESS_TOKEN`, `LINK_SIGNING_SECRET`, TURN credentials | Render env vars | ❌ never |
| Firebase service-account key (FCM V1) | Expo dashboard only | ❌ never |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, Google client ID, `VAPID_PUBLIC_KEY`, `google-services.json` | client | ✅ public by design |

`.env` is git-ignored. Rotate any key that was ever pasted into a chat, ticket or screenshot (see LAUNCH_CHECKLIST).

## Authentication
- Supabase Auth (email/password, Google). In the Android app, Google sign-in runs in the system browser (PKCE) because Google blocks embedded WebViews.
- Every private API route verifies the bearer token server-side before doing anything (AI, email, transcribe, TURN, research, import).
- Sign-in alerts, recent devices, sign out everywhere, password change requires the current password, account deletion with a grace period.

## Authorization highlights
| Area | Control |
|---|---|
| Contacts, research, org profile | owner-only RLS |
| Connections | requests only to people met on Radar/Nearby; de-duplicated; respond/cancel by the right party only |
| Blocking | `radar_is_blocked()` checked in radar, chat, calls and realtime topic auth, both directions |
| Messages | no direct inserts/updates; `send_chat_message` requires connection + no block; 30/min; event rooms members-only, never the Nearby space |
| Calls | no direct writes; `start_call` connected + unblocked + 10 per 5 min; only the callee can answer; only participants can end; 45 s ring window; helper functions not executable by clients |
| Realtime channels | private `chat:<id>` / `call:<u1>_<u2>` topics authorised by `realtime_topic_allowed()` (members only, connected, unblocked) |
| Radar | rotating random tokens (15 min), no location stored, resolve only for active members, periodic revalidation drops blocked/hidden people |
| Push | tokens registered via RPC; dead tokens pruned; call pushes expire after 60 s |
| Google Calendar | refresh tokens encrypted (AES-256-GCM, key derived from `LINK_SIGNING_SECRET`), table readable only by the server; OAuth `state` is HMAC-signed and expires in 10 min; revoked tokens are deleted |
| Google sign-in | code exchanged on the server; only the ID token is handed back (URL fragment / app link — never logged); Supabase verifies it against NetworQ's client ID |

## Input & abuse controls
- Rate limits (express-rate-limit) mounted before routes: global 600/15 min (the secret-protected DB webhook is exempt); AI 60/min; transcribe 20/min; email 20/min; events import 20/min; TTS 30/min; calls 10/min; account/auth 30/min. Daily per-user caps (`increment_ai_usage`): drafts 40, card scans 10, sends 50, research 20, transcriptions 60.
- `/api/transcribe`: audio types only, 1.2 KB–8 MB, friendly errors, no audio stored.
- `/api/email`: `.ics` attachments validated (one VEVENT, ≤ 8000 chars, proper envelope).
- Prospect research: public pages only, `robots.txt` respected, every claim checked against fetched evidence.
- Meeting links must be `https://`; event imports must be real event pages/feeds.
- Helmet headers; CSP per route; CORS exact allow-list (no wildcards; localhost only outside production).
- Android shell: only NetworQ (and Supabase auth) load inside the app, which holds camera/mic permission; every other link opens in the phone's browser.
- TURN: a fresh 1-hour credential per request, never shared.

## Privacy
- Nearby never collects location; distance is approximate and optional ("Show distance"); "Show profile" can reduce what's shared.
- Calls are peer-to-peer (DTLS-SRTP); media never touches our servers (a TURN relay, if configured, only relays encrypted packets).
- Voice notes: audio is sent to the transcription provider and discarded; only the text you save is stored.
- Users can export their data and delete their account.

## Release checklist
- [x] RLS on every table; RPCs are security definer with fixed `search_path`
- [x] No service keys in the client bundle (checked in each release gate)
- [x] All private API routes verify the session
- [x] Rate limits before routes
- [ ] Rotate keys that were shared in chats (owner)
- [ ] Optional: TURN relay credentials as Render env vars (owner)
