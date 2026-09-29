# Security — NetworQ

## Authentication
- All private routes require a valid Supabase JWT
- Tokens verified server-side via `verifyAndLimit.js` before any AI or email action
- Dev bypass tokens (`local-dev-token`) only work in development — never in production
- Password reset handled by Supabase (no custom reset logic)

## Authorization
- Users can only access their own contacts (enforced via `user_id` filter in all Supabase queries)
- Service role key is server-side only — never exposed to client
- Supabase Row Level Security (RLS) should be enabled on all tables

## API Keys — NEVER expose to client
| Key | Location | Safe to expose? |
|---|---|---|
| `GROQ_API_KEY` | Server only | ❌ No |
| `RESEND_API_KEY` | Server only | ❌ No |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | ❌ No |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Client (public) | ✅ Yes (by design) |
| `EXPO_PUBLIC_SUPABASE_URL` | Client (public) | ✅ Yes (by design) |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | Client (public) | ✅ Yes (by design) |

## Rate Limiting
- `email_generation` and `card_scan` are rate-limited via `increment_ai_usage` RPC
- Default: 10 email generations / day, 20 card scans / day per user
- Chat is unlimited (no rate limit to keep AI assistant smooth)

## CORS
- Only allowed origins can call the backend API
- Localhost always allowed for development
- Production: only `networq.com`, `networq-app.surge.sh`, `networq-app.fly.dev`
- No wildcard `*` CORS

## Input Validation
- All backend endpoints validate required fields before processing
- Email addresses are not validated (rely on Supabase auth + Resend validation)
- File uploads (card scan): images only, passed as base64 to Groq — no file stored server-side

## Database Security
- Enable RLS on all Supabase tables
- Users can only SELECT/INSERT/UPDATE/DELETE their own rows
- Service role key bypasses RLS — only used server-side for reminders

## Required Supabase RLS Policies
```sql
-- contacts table
CREATE POLICY "Users own their contacts"
ON contacts FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- follow_up_emails
CREATE POLICY "Users own their emails"
ON follow_up_emails FOR ALL
USING (auth.uid() = user_id);

-- meetings
CREATE POLICY "Users own their meetings"
ON meetings FOR ALL
USING (auth.uid() = user_id);

-- ai_usage
CREATE POLICY "Users own their usage"
ON ai_usage FOR ALL
USING (auth.uid() = user_id);
```

## Secrets Management
- `.env` is in `.gitignore` — never committed to Git
- `.env.example` committed with empty values as template
- Production secrets set via Fly.io `fly secrets set` command
- Never log secrets in console output

## Production Checklist
- [ ] RLS enabled on all tables
- [ ] `SUPABASE_SERVICE_ROLE_KEY` NOT in frontend bundle
- [ ] Dev bypass tokens disabled (or guarded by NODE_ENV check)
- [ ] CORS allowlist is explicit (no wildcards)
- [ ] All API routes validate auth token
- [ ] No sensitive data in error responses
- [ ] HTTPS enforced (Fly.io does this automatically)
