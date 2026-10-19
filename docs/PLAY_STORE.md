# Publishing NetworQ on Google Play

How the Android app is built, what's ready, and the Play Console answers to give.

## How the app is put together

- One backend (Render + Supabase) serves both the website and the app. Accounts and contacts are the same everywhere.
- The Android app is a native shell (`App.native.tsx` / `App.android.tsx`, which must stay identical) that shows
  www.networq.co.in and adds what a browser can't do: Bluetooth Radar, app lock, push notifications, and Android's
  camera/microphone prompts.
- **Screen and feature changes** ship from the server and reach the app the next time it opens. No store update needed.
- **Native changes** (anything in `modules/`, `radar/shellBridge.ts`, `shell/`, `app.json` permissions) need a new
  Play Store version. When you make one, raise `SHELL_BUILD` in `shell/version.ts`, and raise `MIN_SHELL_BUILD`
  in `radar/EventRadar.tsx` if older installs can no longer work. Older apps are then told to update.

## Building

| What | Command | Output |
|---|---|---|
| Test APK for your own phones | `npx eas-cli build --profile preview --platform android` | `.apk` |
| Play Store release | `npx eas-cli build --profile production --platform android` | `.aab` (version code goes up automatically) |
| Upload to Play | `npx eas-cli submit --platform android --profile production` | Needs a Play service-account key the first time |

Signing: EAS keeps the upload key. Keep Play App Signing turned on when Play asks (the default).

## Ready

- Package name `com.networq.app`, app name, adaptive icon, splash.
- Privacy policy https://www.networq.co.in/privacy, terms /terms, account deletion /delete-account (Play requires all three).
- In-app account deletion: Settings → Delete account.
- Bluetooth scan is declared `neverForLocation`. Location is requested only on Android 11 and older, where Android requires it for Bluetooth.
- Permissions Play questions are removed: overlay (`SYSTEM_ALERT_WINDOW`), old storage (`READ/WRITE_EXTERNAL_STORAGE`), `DUMP`.
- Radar shows a consent screen before any Bluetooth use. Play calls this a "prominent disclosure".

## Only you can do this

1. **Play developer account** at play.google.com/console ($25 once). A personal account must run a closed test with
   at least 12 testers for 14 days before going public. An organisation account (needs a D-U-N-S number) skips that.
   Check the current rule when you sign up.
2. **Create the app** in Play Console: name NetworQ, app (not game), free.
3. **Service-account key** for `eas submit` (Play Console → Setup → API access). Keep the JSON file out of git.
4. **Store listing** (text below), plus a 512×512 icon, a 1024×500 feature graphic and 2–8 phone screenshots.
5. **App content forms**: answers below.

## Store listing text (draft)

- **Short description (80 max):** Scan cards, remember everyone, and follow up automatically after every event.
- **Full description:**
  NetworQ is the networking app for people who meet a lot of people.
  • Scan a business card and AI saves the contact in seconds
  • Voice notes: say what you talked about, NetworQ writes it down
  • Who's next: see who's waiting to hear from you
  • Follow-up autopilot: personal emails on Day 1, 7 and 30, sent for you
  • Radar: find NetworQ people near you over Bluetooth and connect with one tap, only with your consent
  • Events: discover real events near you and meet attendees
  Your contacts are private to your account. No ads, and we don't sell your data.
- **Category:** Business. **Contact email:** support@networq.co.in. **Privacy policy:** https://www.networq.co.in/privacy

## App content answers

| Form | Answer |
|---|---|
| Ads | No ads |
| Target audience | 18+ (professionals) |
| Account deletion | Yes, in app and at https://www.networq.co.in/delete-account |
| Government / financial / health app | No |
| News app | No |

### Data safety

Data is encrypted in transit: **Yes**. Users can request deletion: **Yes**. Data sold: **No**.

| Data type | Collected | Shared with | Why | Optional? |
|---|---|---|---|---|
| Name, email, phone, job title/company (account) | Yes | No* | Account, app functionality | Phone, role and company are optional |
| Contacts the user adds or scans | Yes | No* | App functionality | Yes |
| Photos (business-card scans, profile photo) | Yes | No* | App functionality | Yes |
| Audio (voice notes, AI voice questions) | Yes, processed then discarded | No* | App functionality | Yes |
| Messages (chat, follow-up emails the user sends) | Yes | No* | App functionality | Yes |
| Device IDs (push token, sign-in device fingerprint) | Yes | No | Notifications, account security | Push is optional |
| Approximate location | **No** | | | |
| Precise location | **No** (Bluetooth only; no location is read) | | | |

\* Service providers that process data on our behalf (Supabase, Groq, ElevenLabs, Resend, Google sign-in) don't count as
"sharing" under Play's definitions.

### Sensitive permissions to explain if Play asks

- **Nearby devices (Bluetooth scan/advertise/connect):** finding other NetworQ users nearby for Radar; consent shown first; no location derived.
- **Camera:** scanning business cards, video calls.
- **Microphone:** voice notes, AI assistant, calls.
- **Notifications:** follow-up reminders and connection requests.
