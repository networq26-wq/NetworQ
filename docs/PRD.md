# Product Requirements — NetworQ

**One line:** NetworQ is the networking app that makes sure you never lose a conversation — capture people in seconds, know exactly who to follow up with, and stay in touch (message, call, meet) from one place.

**Design principle:** *a 2-year-old or an 80-year-old should understand every screen without being taught.* One idea per screen, plain words, big targets, honest states, real data only.

---

## The problem

People meet dozens of others at events, meetups and meetings, then lose them. Cards end up in a drawer, notes in five apps, and follow-ups never happen. LinkedIn shows *who* you know, not *what you talked about* or *what you promised*. CRMs are built for sales teams, not for the person standing in a conference hallway with a coffee in one hand.

## Who it's for

| Persona | What they need |
|---|---|
| Founders & operators | Turn event conversations into investors, partners and hires |
| Sales / BD professionals | Capture leads at events and follow up the same day |
| Investors | Remember every founder pitch and the promised next step |
| Event-goers & community builders | Find the right people in a room, then stay connected |
| Event organisers (B2B) | Help attendees meet each other (Event Radar codes) |

India-first (cities, events, Whisper for Indian English/Hindi), works worldwide.

---

## What's built (October 2026)

### 1. Capture — get someone into NetworQ in seconds
- **Scan a card** with the camera or from a photo; AI (vision model) fills in name, role, company, email, phone, website. Batch-scan a stack.
- **Voice note:** tap, say who you met and what's next → Whisper transcription → AI extracts details (never invents) → editable review → saved with a follow-up reminder on the day you said ("remind me Thursday").
- **Type it in** manually; **Radar** connections are added automatically when someone accepts.
- **Your card:** a credit-card-style digital card with your photo and official logo; the back is a vCard QR any phone camera can save; share as a file; write to an NFC card.

### 2. Remember — know who matters and why
- **People (home):** greeting with one live line ("2 people are waiting to hear from you"), an at-a-glance strip (People · To follow up · Opportunities · Intros), quick actions.
- **Who's next:** overdue / due follow-ups first, then people you met recently but never emailed — each with a plain reason and one button.
- **Coming up:** this week's real events in your city (India-first) — places to meet people.
- Contact list with search, role and tag filters, one-tap Email / Meet; contact sheet with notes, timeline, tags, reminders.
- **AI assistant** (bottom-sheet copilot): ask about your network ("who should I follow up with first?"), voice input (works in the Android app), spoken replies.

### 3. Follow up — actually stay in touch
- **Follow-up emails:** personal AI drafts for one person, a selection, or everyone due; edit, then send all (paced to stay under limits; failures reported honestly).
- **Select mode:** tick people (or select all in a filter) → *Email N* or *Message N*.
- **AI prospect research:** reads a company's public website (robots.txt respected), writes 3 drafts, fact-checks every claim against sources, logs it to the contact.
- **Meetings:** pick a length; Google Meet (one tap with Google), a pasted link (Zoom/Teams/…), or a free Jitsi room; a real calendar invite (`.ics`, METHOD:REQUEST) lands in their calendar with Accept/Decline.
- **Reminders:** daily server job + push + email.

### 4. Connect — talk to your people
- **Messages:** private 1:1 chat between connected people; live delivery, typing indicator, read receipts, unread badges, push notifications; blocked people can't message; 30 msgs/min limit. *New message* lists contacts — on NetworQ → chat/call; not yet → Invite (share sheet, WhatsApp, email).
- **Voice & video calls (1:1):** ring anywhere in the app and via push (60-second expiry) when closed; accept/decline; mute, camera on/off, flip camera; missed/declined/cancelled states in the bell; connected + unblocked only; 10 calls / 5 min. Optional TURN relay for strict networks.

### 5. Meet new people
- **Radar — Nearby:** discover NetworQ people within Bluetooth range (Android app) with rotating anonymous IDs (15 min), approximate distance, and connection requests — no location collected. Discoverable switch, privacy controls, blocking.
- **Radar — Events:** join with an event code (or "Going" from Events), see who's there, connect, event room chat; organisers create events and share codes.
- **Events:** real events imported from Luma, Eventbrite, Meetup, calendar feeds and pasted links; de-duplicated and categorised; search with location sheet, All/Today/Weekend/This week + month calendar; grouped by day; card-style events with Going / Add to calendar / Event page / Add contact.

### 6. Trust & control
- Email/password + Google sign-in (system browser in the Android app), password change/set, email change, recent devices, sign out everywhere, account deletion with a grace period.
- Notification preferences (push, connection emails, reminders, sign-in alerts, product updates), vibration, dark mode.
- Privacy & blocking, data export (CSV), help & support.

### Platforms
Web (desktop + mobile browsers) and an Android app (WebView shell with native camera, microphone, Bluetooth, push and back-button handling). iOS: same web app in Safari today; native shell planned.

---

## What's next

| Priority | Item |
|---|---|
| ✅ Built (7 Oct) | Group calls (up to 6, mesh) and photos & files in chat |
| Next | Screen share, group chats, TURN relay account |
| Next | iOS app (EAS) and Play Store listing |
| Later | CSV / LinkedIn import, CRM sync (HubSpot, Salesforce, Zoho) |
| Later | Teams / organisation workspaces and shared event lists |
| Later | Subscription billing (Pro: unlimited AI research, team features) |

## Success criteria
A new user, untaught, can: sign up → add a person by card, voice or Radar → see them in *Who's next* → send a follow-up email → message or call them → schedule a meeting that lands in their calendar → find and join an event.
