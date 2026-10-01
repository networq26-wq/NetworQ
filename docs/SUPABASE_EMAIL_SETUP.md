# Supabase auth emails — production setup

Supabase's built-in email sender delivers **only to your project's team members** and is heavily rate-limited. Until custom SMTP is configured, real users will not receive confirmation or password-reset emails.

## 1. Send through Resend (custom SMTP)

1. In Resend, verify your domain (e.g. `networq.co.in`) and create an API key.
2. In Supabase, go to **Authentication → Emails → SMTP Settings** → *Enable custom SMTP*:
   - Host `smtp.resend.com`, port `465`, username `resend`, password = Resend API key
   - Sender email `noreply@networq.co.in`, sender name `NetworQ`
3. In **Authentication → Rate Limits**, raise the email limit (e.g. 100/hour).
4. Set the same sender for the app server: `RESEND_FROM_EMAIL="NetworQ <noreply@networq.co.in>"`.

## 2. Branded templates

Under **Authentication → Emails → Templates**, paste:

| Template | File | Subject |
|---|---|---|
| Confirm signup | `supabase/templates/confirm-signup.html` | Confirm your NetworQ email |
| Reset password | `supabase/templates/reset-password.html` | Reset your NetworQ password |
| Change email address | `supabase/templates/change-email.html` | Confirm your new NetworQ email |
| Magic link | `supabase/templates/magic-link.html` | Your NetworQ sign-in link |

## 3. Security settings

- **Authentication → Providers → Email**:
  - Turn on *Secure email change*, so the change is confirmed from both the old and the new inbox.
  - Turn on *Secure password change*.
  - Set minimum password length to 8.
- **Authentication → URL Configuration**: Site URL `https://www.networq.co.in`; add it to Redirect URLs.

## 4. Emails the NetworQ server sends (already built)

Welcome, new sign-in alert (with "secure my account"), password changed, and account deletion scheduled. These come from `api/account.js` through Resend. Optionally set `LINK_SIGNING_SECRET` (32+ random chars) and `PUBLIC_APP_URL`.
