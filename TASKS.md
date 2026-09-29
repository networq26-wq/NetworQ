# TASKS — NetworQ

## Phase 1: Foundation ✅ COMPLETE
- [x] Project setup (Expo + React Native Web)
- [x] Supabase auth (email + Google OAuth)
- [x] Splash screen with Q scanner animation (5 seconds)
- [x] Dark/light mode theming
- [x] Mobile responsive layout

## Phase 2: Core Features ✅ COMPLETE
- [x] Contact CRUD (add, edit, delete, view)
- [x] Contact display picture (photo or icon silhouette)
- [x] Contact search + role filters
- [x] Card scanner (Groq vision AI)
- [x] Company enrichment (web scraper)
- [x] Digital Pass + QR code

## Phase 3: AI & Communication ✅ COMPLETE
- [x] AI assistant (Groq chat)
- [x] Voice input (Web Speech Recognition)
- [x] Text-to-speech replies
- [x] Email follow-up drafting (AI)
- [x] Email sending (Resend backend)
- [x] Bulk follow-up dispatch
- [x] Meeting scheduler + invite email

## Phase 4: Events & Reminders ✅ COMPLETE
- [x] Events Hub (23 future events Oct–Dec 2026)
- [x] Event city/category/search filters
- [x] Browser push notifications for reminders
- [x] Server-side reminder engine (hourly check + email)
- [x] Proximity Radar

## Phase 5: Backend & Infrastructure ✅ COMPLETE
- [x] Express backend (server.js)
- [x] /api/ai, /api/email, /api/enrich, /api/health routes
- [x] CORS configured (localhost + surge + fly.io)
- [x] Waitlist page
- [x] Surge.sh deployment
- [x] Fly.io config (Dockerfile + fly.toml)
- [x] Railway config (railway.toml + Procfile)
- [x] Project docs (PRD, ARCH, DESIGN, SECURITY, etc.)

---

## Phase 6: Production Launch 🔄 IN PROGRESS
- [ ] TASK-601: Push code to GitHub
  ```bash
  git add . && git commit -m "feat: v1 complete" && git push
  ```
- [ ] TASK-602: Sign up at resend.com → add RESEND_API_KEY to .env
- [ ] TASK-603: Deploy to Fly.io
  ```bash
  brew install flyctl
  fly auth signup
  fly apps create networq-app
  fly secrets set GROQ_API_KEY="..." RESEND_API_KEY="..." ...
  fly deploy
  ```
- [ ] TASK-604: Connect GoDaddy domain to Fly.io via Cloudflare DNS
- [ ] TASK-605: Add Supabase RLS policies (docs/SECURITY.md)
- [ ] TASK-606: Add increment_ai_usage SQL function (docs/SECURITY.md)
- [ ] TASK-607: Full production QA using TEST_PLAN.md

---

## Phase 7: V2 Features 📋 PLANNED
- [ ] TASK-701: Mobile app — EAS Build (iOS + Android)
- [ ] TASK-702: Push notifications (Expo Push / FCM)
- [ ] TASK-703: CSV contact import
- [ ] TASK-704: LinkedIn contact import
- [ ] TASK-705: Analytics dashboard (contacts over time, follow-up rate)
- [ ] TASK-706: Team/organization accounts
- [ ] TASK-707: Subscription payments (Stripe)
- [ ] TASK-708: App Store + Play Store submission
- [ ] TASK-709: Refactor App.tsx into separate feature files
- [ ] TASK-710: Add Playwright E2E tests

---

## How to work on tasks
1. Pick the next unchecked task from current phase
2. Implement it
3. Test against TEST_PLAN.md
4. Mark as [x] complete
5. Commit with descriptive message
6. Move to next task
