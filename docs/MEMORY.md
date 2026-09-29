# Project Memory — NetworQ

## Current Status
**V1 Complete — Deployed to surge.sh and Fly.io config ready**

---

## Completed Features
- [x] Auth (email + Google OAuth)
- [x] Splash screen (5s, Q scanner animation)
- [x] Contact management (CRUD + search + filter)
- [x] Card scanner (Groq vision AI)
- [x] AI assistant (Groq chat + voice STT + TTS)
- [x] Email follow-ups (Resend backend)
- [x] Bulk follow-up dispatch
- [x] Meeting scheduler + invite email
- [x] Events Hub (23 events, Oct–Dec 2026)
- [x] Reminders (browser + server email)
- [x] Proximity Radar
- [x] Digital Pass / QR code
- [x] Company enrichment (web scraper)
- [x] Waitlist page
- [x] Dark / light mode
- [x] Mobile responsive
- [x] Surge.sh deployment (live)
- [x] Fly.io config (Dockerfile, fly.toml)
- [x] Railway config (railway.toml, Procfile)
- [x] Project documentation (PRD, ARCH, DESIGN, etc.)

---

## Current Deployment
- **Live URL:** https://networq-app.surge.sh
- **Local:** http://localhost:3000 (node server.js)
- **Backend:** Express on ports 3000/3001/8081

---

## Pending / In Progress
- [ ] Fly.io production deploy (needs `fly auth login` + `fly deploy`)
- [ ] Resend API key (sign up at resend.com)
- [ ] GoDaddy domain DNS → Fly.io
- [ ] Supabase RLS policies (add via SQL editor)
- [ ] `increment_ai_usage` SQL function (add via SQL editor)
- [ ] GitHub repo push (for Fly.io auto-deploy)

---

## Known Issues
- Reminder engine shows `fetch failed` in sandbox (works fine with real network)
- `node-cron` blocked by security policy — using `setInterval` instead (works fine)
- Gmail App Passwords unavailable on Workspace accounts → using Resend instead

---

## Environment Variables Status
| Variable | Status |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | ✅ Set |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | ✅ Set |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Set |
| `GROQ_API_KEY` | ✅ Set |
| `RESEND_API_KEY` | ⏳ Needs signup at resend.com |
| `RESEND_FROM_EMAIL` | ⏳ After domain verification |

---

## Key Files
| File | Purpose |
|---|---|
| `App.tsx` | Entire React frontend (~8500 lines) |
| `server.js` | Express backend + multi-port + reminder engine start |
| `api/ai.js` | Groq AI proxy |
| `api/email.js` | Resend email handler |
| `api/reminders.js` | Hourly reminder checker |
| `api/enrich.js` | Company web scraper |
| `Dockerfile` | Fly.io container build |
| `fly.toml` | Fly.io deployment config |
| `railway.toml` | Railway deployment config |
| `Procfile` | Heroku/Render/Koyeb compat |

---

## Next Steps (Priority Order)
1. Push code to GitHub (`git push`)
2. Sign up at resend.com → add `RESEND_API_KEY` to `.env`
3. Run `brew install flyctl` → `fly auth signup` → `fly deploy`
4. Add GoDaddy domain DNS records → Fly.io
5. Add Supabase RLS policies + `increment_ai_usage` function
6. Test full flow on production URL
