# Changelog

## 2026-10-05 — "Talk to your people" release

### New
- **Voice & video calls (1:1)** that ring on any screen and by push when the app is closed; accept/decline, mute, camera, flip; missed/declined in the bell; optional TURN relay.
- **Messages:** inbox, *New message* contact picker (chat/call people on NetworQ, invite everyone else), live chat with typing and read receipts, push notifications.
- **Voice note rebuilt:** record → Whisper transcription → AI-extracted details you review → saved with a reminder on the day you said. The AI assistant's mic uses the same engine (now works in the Android app).
- **People home:** live greeting line, at-a-glance strip, round quick actions, *Who's next*, *Coming up* (this week's events in your city), Select mode with bulk email / message.
- **Events redesign:** search with a location sheet, All/Today/Weekend/This week + month calendar, day-grouped results, card-style events with *Going*.
- **Your card:** premium credit-card design with the official logo and your photo; QR on the back.
- **Me:** one entry (header avatar); settings split into simple sub-pages.
- **Official logo everywhere** (app + website) with the Q scan beam in brand violets.
- **Meetings:** Google Meet / pasted link / Jitsi with a real calendar invite (Accept/Decline).
- **Push notifications** on Android (Expo/FCM) and browsers (Web Push).
- **AI prospect research** with fact-checked drafts and sources.
- **Nearby Radar** (Bluetooth, rotating IDs, no location) alongside Event Radar.

### Fixed
- Back button now steps back screen by screen everywhere and exits only from home (app + Android shell).
- Voice notes were silently discarded (wrong address, non-existent columns) — now saved correctly with reminders.
- Calls screen could be covered by the chat window — calls now sit above everything.
- Follow-ups: no "sent" mark if the save failed; large batches paced under the email limit.
- AI copilot in the local preview pointed at the wrong server.
- Events stored as date-only now read "All day" instead of a fake 5:30 AM.
- Radar: one clear message per state, no duplicate intro cards, aligned buttons.
- 18 misaligned badges/pills; alignment across lists, sheets and toolbars.
- Leftover Android build files that broke clean EAS builds.

### Security
- Calls and messages written only through checked database functions (connected + unblocked, rate-limited); private realtime channels.
- Speech-to-text and TURN endpoints require a signed-in user; rate limits before routes.
