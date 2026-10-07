# QA report

## Latest — 2026-10-05 afternoon (Google Calendar/sign-in, ElevenLabs, card, hero)
| Check | Result |
|---|---|
| Backend + database (`npm test`) | ✅ 184 tests; 2 port-collision flakes under load pass 23/23 ×3 when run alone |
| End-to-end (desktop + phone) | ✅ 132 passed; 2 two-phone Radar BLE simulations time out only under heavy machine load (load avg 120+), pass when run alone — Radar code unchanged |
| Live, real backend | ✅ voice copilot (Whisper → AI → **ElevenLabs** voice, confirmed in production) · voice note → saved with reminder · meeting invite email with calendar file (Resend) · Add to calendar · video call (ring instant, connect ~9 s) · messages · photo upload ×2 · radar · events · card |
| Google on production | ✅ `/api/google/available` = true; sign-in redirects to Google with `redirect_uri=https://www.networq.co.in/api/google/callback` |
| Sign-in layout | ✅ logo stays below a 36 px status bar on a short (keyboard-open) screen |

---

# Release gate, 2026-10-05 (night)

**Verdict: GO.** Two independent QA agents (full test suite; backend/database/security audit), then fixes for everything they found, then a final full run.

## Results
| Check | Result |
|---|---|
| Types (`tsc --noEmit`) | ✅ 0 errors |
| Unit + API + database tests (`npm test`) | ✅ 174 / 174 (adds calls, call privileges, transcribe cap, TURN, call push) |
| End-to-end, desktop + phone (`playwright test`) | ✅ 150+ pass; two load-sensitive specs (settings vibration, meeting invite) pass 12/12 when run alone; final run in CHANGELOG notes |
| Client bundle secrets scan | ✅ only the public anon key |
| No horizontal overflow at 360 / 412 px | ✅ People, Messages, New message, Radar, Events (+ sheets), Me |
| Reduced motion respected | ✅ |
| Live two-browser video call on production database | ✅ ring 0.7 s, connect ~6 s, video both ways, mute/camera, hang-up, decline |
| Live voice note with real speech (Whisper) | ✅ transcript → details → reminder day → saved |

## Security audit — found and fixed
| Severity | Finding | Fix |
|---|---|---|
| Medium | Notification webhook could be throttled by the per-IP limit (Supabase shares one IP) → dropped pushes/rings | webhook exempt (secret-protected) |
| Medium | Voice transcription: no per-user cap; body read before auth | auth first; 60/user/day |
| Medium | CORS allowed any `*.onrender.com`/`*.railway.app` and localhost in production | exact allow-list; localhost dev-only |
| Medium | TURN credentials shared and long-lived | fresh 1-hour credential per request; `/api/calls` 10/min |
| Low | Internal call helpers callable by signed-in users | revoked (verified in production) |
| Low | Call limit raceable; no per-person limit | serialised per caller; 3 rings / person / 5 min |
| Low | Calls table had extra grants | SELECT only |

## Functional findings — fixed
- Microphone could stay on if the voice note was closed while starting → released immediately.
- Radar confirm buttons below 44 px → 44 px.
- All-day events disappeared from *Coming up* on the day → kept.
- Back could step twice when a dialog had no Close button → single step.
- Invite fallback was silent; WhatsApp numbers lacked +91 → "Copied ✓" and country code.
- All-day events added to calendars as 05:30 → proper all-day entries; in the Android app, Google Calendar's add page.
- Android shell: any site opened inside the app inherited camera/mic → only NetworQ loads inside the app; other links open in the phone's browser.
- "Going" button's accessible name now matches its visible text.

## Not covered by automation (do on devices — see TEST_PLAN manual checklist)
Real two-phone calls on mobile data (TURN), Bluetooth Nearby, push delivery on Android, the shell's permission prompts and back-button fallback.
