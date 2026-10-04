# Project state — NetworQ (2026-10-05)

## Where things live
- **Production:** https://www.networq.co.in (Render, auto-deploys `main`). Supabase project `jpuxmkkuzqojqeatespa`.
- **App code:** branch `feat/ui-polish` (worktree `NetworQ-push`) → merged to `main` when the release gate passes.
- **Marketing/website:** `landing/` on branch `gemini/sync-all` (Gemini/Antigravity), worktree `NetworQ-main`.
- **Android:** EAS project `networ-q/NetworQ`, `npm run build:apk` (preview APK).

## Status
- All features in `docs/PRD.md` "What's built" are live on the web and in the app shell.
- Database migrations through `20261013_calls.sql` are applied in production.
- Latest release gate: see `docs/QA_REPORT.md`.

## Owner to-dos
See `docs/LAUNCH_CHECKLIST.md` (new APK, key rotation, Groq upgrade, push keys, support mailbox, OAuth verification, device tests, optional TURN).

## Known limits (honest)
- Nearby Radar needs the Android app (browsers can't use Bluetooth).
- Calls are 1:1; on very strict networks they need a TURN relay (env vars ready).
- Groq free tier limits AI throughput until upgraded.
- iOS: web app in Safari; native shell not built yet.

## Working agreements
- Never commit `.env` or paste secrets; real data only — no mock or fabricated features; database-enforced access for anything social.
- Every change: types + `npm test` + E2E green before pushing to `main`.
