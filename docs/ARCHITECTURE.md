# Architecture — NetworQ

## Overview
NetworQ is a single-page React application with an Express.js backend, all served from one Node.js process.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (Expo Web / React Native Web) |
| Language | TypeScript |
| Styling | Inline styles (Apple HIG system) |
| Backend | Node.js + Express.js |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email + Google OAuth) |
| AI | Groq API (llama-4-scout vision, qwen3.8 text) |
| Email | Resend API |
| Deployment | Fly.io (prod) + Surge.sh (static mirror) |
| DNS | Cloudflare (recommended) |

---

## Application Architecture

```
User Browser / Mobile App
         │
         ▼
    node server.js (Express)
         │
         ├── GET  /*              → Serves React SPA (dist/)
         ├── POST /api/ai         → Groq AI proxy
         ├── POST /api/email      → Resend email sender
         ├── ALL  /api/enrich     → Company web scraper
         ├── GET  /api/health     → Health check
         ├── GET  /waitlist       → Waitlist HTML page
         │
         └── Background: Reminder Engine (setInterval 1hr)
                   │
                   └── Supabase → checks due reminders → Resend email

Supabase (external)
  ├── auth.users        (authentication)
  ├── contacts          (user contacts)
  ├── follow_up_emails  (sent email log)
  ├── meetings          (scheduled meetings)
  ├── ai_usage          (rate limiting)
  └── waitlist          (waitlist signups)

Groq API (external)
  ├── qwen/qwen3.8-27b                      (chat, email drafting)
  └── meta-llama/llama-4-scout-17b-16e      (card scanning / vision)

Resend API (external)
  └── email delivery (follow-ups, reminders, meeting invites)
```

---

## Frontend Architecture

### Single File App
The entire React frontend lives in `App.tsx` (~8500 lines).

### Key Sections
```
App.tsx
  ├── Icons (SVG components)
  ├── Types & Interfaces
  ├── Utility Functions (tagColor, callAI, sendEmailViaBackend)
  ├── Sub-components
  │     ├── ContactAvatar
  │     ├── EventsHub
  │     ├── CommandPalette
  │     └── Toast system
  ├── Main App component
  │     ├── State management (useState)
  │     ├── Auth flow (splash → login → app)
  │     ├── Sidebar navigation
  │     ├── Contact table / grid views
  │     ├── Contact modal
  │     ├── AI Assistant floating dock
  │     ├── Card scanner modal
  │     ├── Email composer modal
  │     ├── Meeting scheduler modal
  │     └── Radar / QR / Events tabs
  └── Confetti + Toast overlays
```

### Screen Flow
```
Splash (5s) → Login/Signup → App
                               │
                ┌──────────────┼──────────────┐
                ▼              ▼              ▼
           Contacts        Events Hub      Radar
           Table/Grid      (Events)        (Map)
                │
          ┌─────┴─────┐
          ▼           ▼
      Contact      AI Assistant
      Modal        (floating)
```

---

## Backend Architecture

```
server.js
  ├── Loads .env
  ├── CORS (localhost + surge + fly.io + custom domain)
  ├── Routes → api/*.js handlers
  └── Starts reminder engine (api/reminders.js)

api/
  ├── ai.js           → Groq proxy with fallback responses
  ├── email.js        → Resend → SMTP fallback → dev log
  ├── enrich.js       → Company website scraper
  ├── waitlist.js     → Waitlist HTML server
  ├── reminders.js    → Hourly reminder checker + emailer
  └── _lib/
        ├── groq.js           → Model config + request builder
        ├── verifyAndLimit.js → JWT verify + rate limiting
        └── cors.js           → Origin allowlist checker
```

---

## Database Schema (Supabase)

```sql
-- Contacts
contacts (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users,
  name text,
  company text,
  role text,
  role_category text,
  email text,
  phone text,
  linkedin text,
  tags text[],
  notes text,
  image text,
  reminder text,
  reminder_date date,
  reminder_done boolean DEFAULT false,
  email_sent boolean DEFAULT false,
  meet_link text,
  meet_date text,
  event text,
  created_at timestamptz DEFAULT now()
)

-- AI usage tracking
ai_usage (
  user_id uuid,
  action text,
  date date,
  count integer,
  PRIMARY KEY (user_id, action, date)
)

-- Follow-up email log
follow_up_emails (
  id uuid PRIMARY KEY,
  user_id uuid,
  contact_id uuid,
  draft text,
  sent boolean,
  sent_at timestamptz
)

-- Meetings
meetings (
  id uuid PRIMARY KEY,
  user_id uuid,
  contact_id uuid,
  meet_link text,
  meet_date text,
  meet_time text,
  notes text
)

-- Waitlist
waitlist (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  name text,
  created_at timestamptz DEFAULT now()
)
```

---

## Deployment Architecture

```
Developer Machine
      │
      ├── git push → GitHub
      │                │
      │                └── Fly.io (auto-deploy)
      │                        │
      │                        ├── Docker build (Dockerfile)
      │                        ├── node server.js (always on)
      │                        └── Bangalore region (blr)
      │
      └── npx surge dist/ → networq-app.surge.sh (manual)

DNS (GoDaddy → Cloudflare)
      │
      ├── www  → Fly.io app URL
      └── @    → Fly.io IP
```

---

## Architectural Rules
1. UI components must not contain direct database logic
2. All Supabase calls go through the component's useEffect or event handlers
3. All backend calls (AI, email) go through the Express proxy — never direct from frontend to Groq/Resend
4. API keys (GROQ, RESEND, SUPABASE_SERVICE_ROLE) are server-side only
5. EXPO_PUBLIC_* vars are client-safe (anon key, public URLs only)
6. The reminder engine runs as a background setInterval — never block the main event loop
