# Test Plan — NetworQ

## Authentication
- [ ] User can sign up with email + password
- [ ] User cannot sign up with duplicate email
- [ ] User can log in with correct credentials
- [ ] User cannot log in with wrong password (error shown)
- [ ] User can reset password via email
- [ ] Google OAuth login works
- [ ] Session persists on page refresh
- [ ] Logout clears session and redirects to login
- [ ] Unauthenticated users cannot access the app

## Splash Screen
- [ ] Logo displays for exactly 5 seconds before login
- [ ] Q scanner animation plays during splash
- [ ] Logged-in users also see 5-second splash before app loads

## Contact Management
- [ ] User can add a contact manually
- [ ] Required fields (name) are validated
- [ ] User can edit a contact
- [ ] User can delete a contact
- [ ] User cannot see another user's contacts
- [ ] Contact photo uploads and displays
- [ ] Tags can be added and removed
- [ ] Search filters contacts correctly
- [ ] Role filter chips work

## Card Scanner
- [ ] Camera/image upload triggers AI extraction
- [ ] Extracted fields pre-fill the add contact form
- [ ] User can edit extracted data before saving
- [ ] Vision API error shows friendly message

## AI Assistant
- [ ] AI chat window opens from floating dock
- [ ] Messages send and receive responses
- [ ] Voice input (microphone) activates and sends
- [ ] TTS plays back AI response when toggled
- [ ] Quick action chips send predefined queries
- [ ] AI has context of user's contacts
- [ ] Offline fallback message shows when AI unreachable

## Email (Follow-ups)
- [ ] AI drafts follow-up email for a contact
- [ ] User can edit the draft before sending
- [ ] Email sends successfully via /api/email
- [ ] Success toast and confetti on send
- [ ] Contact marked as email_sent in DB
- [ ] Bulk send dispatches all follow-ups
- [ ] Meeting invite email sends correctly

## Reminders
- [ ] Setting a reminder on a contact saves to Supabase
- [ ] Browser notification fires immediately on Set Reminder
- [ ] Reminder engine (server) checks Supabase on startup
- [ ] Reminder email sent when reminder_date <= today
- [ ] Contact marked reminder_done after email sent

## Events Hub
- [ ] Events load and display correctly
- [ ] All event dates are in the future (Oct–Dec 2026+)
- [ ] City filter works
- [ ] Category filter works
- [ ] Search filters events
- [ ] Set Reminder button triggers browser notification
- [ ] Add to Calendar generates .ics file
- [ ] AI Discover generates new events for a city

## Radar / Network Map
- [ ] Radar renders contacts as nodes
- [ ] Clicking a node shows contact inspector
- [ ] Filter by role works
- [ ] Proximity zones are correct

## Digital Pass / QR
- [ ] QR code generates from user profile
- [ ] QR contains correct contact info
- [ ] Download QR works

## Responsive Design
Test at:
- [ ] 375px (iPhone SE)
- [ ] 390px (iPhone 14)
- [ ] 768px (iPad)
- [ ] 1280px (Laptop)
- [ ] 1440px (Desktop)

## API Endpoints
- [ ] GET  /api/health → `{ status: "ok" }`
- [ ] POST /api/ai → returns AI response
- [ ] POST /api/email → sends email or logs in dev
- [ ] POST /api/enrich → returns company metadata
- [ ] GET  /waitlist → returns HTML page

## Build
- [ ] `npx tsc --noEmit` passes (0 errors)
- [ ] `npm run build:web` succeeds
- [ ] Built app loads in browser from dist/
- [ ] Illustrations load from dist/illustrations/
- [ ] Waitlist page loads at /waitlist.html
