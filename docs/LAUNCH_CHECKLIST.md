# Launch checklist — things only the owner can do

Everything in the code is done and tested. These need *your* accounts, payments or decisions.

## Must do
| # | What | Why | How (≈ time) |
|---|---|---|---|
| 1 | **Install the new APK** on your phone (and a second phone) | Calls, microphone and the back-button fix need the new shell | Download from the EAS link (or `~/Desktop/NetworQ.apk`), uninstall the old app first (5 min) |
| 2 | **Rotate keys that were pasted in chats** (Supabase `sbp_…` access token, Render `rnd_…`, Groq `gsk_…`, ElevenLabs `sk_…`) | They're exposed in chat history | Supabase → Account → Access tokens → revoke · Render → Account → API keys · Groq console → new key, then update `GROQ_API_KEY` on Render (10 min) |
| 3 | **Upgrade Groq** to a paid/dev tier | Free tier allows ~1,000 output tokens/min per model — the AI will say "busy" at real usage | console.groq.com → Billing (5 min) |
| 4 | **VAPID keys on Render** (if not yet) | Browser push notifications | Values are in `~/Desktop/networq-push-keys.txt` → Render env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:support@networq.co.in` (5 min) |
| 5 | **FCM V1 key in Expo** (if not yet) | Android push notifications | Firebase → Project settings → Service accounts → Generate key → expo.dev → Project → Credentials → Android → FCM V1 (10 min) |
| 6 | **Create the support@networq.co.in mailbox** | Help & support links and email sender | Your domain/email provider (10 min) |
| 7 | **Google verification** | NetworQ name + logo on Google's screen; Calendar for everyone without warnings | ✅ Domain verified (5 Oct) · ✅ redirect URI + new client secret on Render · ⏳ after 24 h: Branding → "I have fixed the issues" · ⏳ Publish app + submit calendar scope for verification |
| 8 | **Test on two real phones** with the manual checklist in `docs/TEST_PLAN.md` | Bluetooth Radar and push can only be verified on devices | (30 min) |

## Recommended
| What | Why | How |
|---|---|---|
| **TURN relay** (free tier) | Some mobile/office networks block direct calls; a relay makes calls connect everywhere | Cloudflare Calls → TURN key → Render env `CF_TURN_KEY_ID` + `CF_TURN_API_TOKEN` (or Metered: `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`). No code change. |
| **Resend domain verification** | Emails from `@networq.co.in` land in inbox, not spam | resend.com → Domains → add DNS records |
| **Push the website branch** | Website logo fix + Gemini's waitlist updates | `git push origin gemini/sync-all` from the NetworQ-main folder, then deploy the site |
| **Play Store listing** | Public distribution | Google Play Console ($25 once) → production build with `eas build --profile production` |
| **Privacy policy / terms review** | Store requirement | `/privacy`, `/terms` pages exist — have them reviewed |

## Decisions for you
- Group calls & screen share: Jitsi (free, self-serve) vs LiveKit (free tier, more control)?
- Pricing: what's free vs Pro (e.g. AI research volume, team workspaces)?
