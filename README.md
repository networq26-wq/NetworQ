# NetworQ — Professional Network Intelligence

> Scan cards. Track relationships. Never lose a connection.

**Live:** https://networq-app.surge.sh

---

## Features
- 🃏 **Card Scanner** — Photo → AI extracts contact details instantly
- 🤖 **AI Assistant** — Chat, voice input, follow-up drafting (Groq)
- 📧 **1-Click Follow-ups** — AI-drafted + bulk email send (Resend)
- 🗓️ **Events Hub** — Curated business events across 9 cities
- ⏰ **Smart Reminders** — Browser + email reminders via server engine
- 📡 **Proximity Radar** — Visual network map
- 🪪 **Digital Pass** — Your contact card as a QR code

---

## Tech Stack
- **Frontend:** React (Expo Web), TypeScript
- **Backend:** Node.js, Express.js
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth (email + Google OAuth)
- **AI:** Groq API
- **Email:** Resend
- **Hosting:** Fly.io (backend+frontend) / Surge.sh (static)

---

## Local Development

### 1. Clone & Install
```bash
git clone https://github.com/your-username/NetworQ-main.git
cd NetworQ-main
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Fill in your keys in .env
```

### 3. Start Backend Server
```bash
node server.js
# Runs on http://localhost:3000
```

### 4. Start Frontend Dev Server (optional)
```bash
npx expo start --web
# Runs on http://localhost:8081
```

### 5. Build for Production
```bash
EXPO_NO_TELEMETRY=1 npm run build:web
mkdir -p dist/illustrations
cp -r public/illustrations/* dist/illustrations/
cp public/waitlist.html dist/waitlist.html
```

---

## Deploy to Fly.io
```bash
brew install flyctl
fly auth signup
fly apps create networq-app
fly secrets set GROQ_API_KEY="..." RESEND_API_KEY="..." SUPABASE_SERVICE_ROLE_KEY="..."
fly deploy
```

## Deploy to Surge (static frontend only)
```bash
npx surge dist/ networq-app.surge.sh
```

---

## Project Documentation
| File | Purpose |
|---|---|
| [docs/PRD.md](docs/PRD.md) | What we're building and why |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it's built |
| [docs/DESIGN.md](docs/DESIGN.md) | Design system |
| [docs/SECURITY.md](docs/SECURITY.md) | Security requirements |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Testing checklist |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture decisions |
| [docs/MEMORY.md](docs/MEMORY.md) | Current project state |
| [TASKS.md](TASKS.md) | Task breakdown + roadmap |

---

## Environment Variables
See [`.env.example`](.env.example) for all required variables.

---

## License
Private — All rights reserved © NetworQ 2026
