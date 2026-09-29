# Product Requirements Document — NetworQ

## Product
**NetworQ** — Professional Network Intelligence Platform

## Problem
Professionals at networking events, conferences, and meetups collect business cards and LinkedIn connections but lose track of who they met, what was discussed, and when to follow up. Contact data is scattered across apps, emails, and notes with no intelligent layer on top.

## Target Users
- Founders and startup builders
- Sales professionals and BDMs
- Investors and VCs
- Conference and event attendees
- Anyone who networks professionally

## Goal
Give professionals one intelligent place to manage their network — scan cards, track relationships, get AI-assisted follow-ups, and never lose a connection again.

---

## Core Features (Built)

### 1. Authentication
- Email + password signup/login
- Google OAuth
- Password reset via email
- Session persistence

### 2. Contact Management
- Add contacts manually or via card scanner
- Store: name, company, role, email, phone, LinkedIn, tags, notes
- Contact photos / display pictures
- Search and filter contacts

### 3. AI Assistant
- Groq-powered chat (llama/qwen models)
- Context-aware: knows all your contacts, roles, events
- Voice input (Web Speech Recognition)
- Text-to-speech replies
- Quick action chips

### 4. Card Scanner
- Photo → AI extracts contact details
- Vision model (llama-4-scout)
- One-tap add to contacts

### 5. 1-Click Follow-ups
- AI drafts personalized email for each contact
- Bulk send all follow-ups at once
- Email sent via Resend API backend

### 6. Events Hub
- 23 curated business/tech events (Oct–Dec 2026)
- Filter by city, category, search
- Set reminders with browser notifications
- RSVP + add to calendar

### 7. Proximity Radar
- Visual network map
- Filter by role, tags, industry

### 8. Digital Pass / QR Code
- Your shareable contact card as QR
- Recipients scan → add you instantly

### 9. Reminder Engine
- Set reminders on contacts
- Backend checks Supabase hourly
- Sends email via Resend when due

### 10. Waitlist
- Public waitlist page
- Supabase-powered signups

---

## MVP (Completed)
- [x] Auth (email + Google)
- [x] Contact CRUD
- [x] AI assistant (Groq)
- [x] Card scanner
- [x] Email follow-ups (Resend backend)
- [x] Events Hub
- [x] Reminders
- [x] Surge.sh deployment
- [x] Fly.io deployment config

## Next Version (V2)
- [ ] Push notifications (Expo / FCM)
- [ ] Mobile app (iOS + Android via EAS Build)
- [ ] Contact import from LinkedIn/CSV
- [ ] CRM integrations (HubSpot, Salesforce)
- [ ] Team/organization accounts
- [ ] Analytics dashboard
- [ ] Payments (subscription)

## Out of Scope (V1)
- Payments / subscriptions
- Social feed
- Video calls
- Public profiles
- Team collaboration

---

## Success Criteria
A user should be able to:
1. Sign up and log in
2. Add a contact (manually or via card scan)
3. Get an AI-drafted follow-up email
4. Send that email to the contact
5. Set a reminder and receive it by email
6. Browse upcoming events
7. Share their digital pass via QR
