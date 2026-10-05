-- Connected Google Calendars (for creating Google Meet invites from the server, on web and in the app).
-- Refresh tokens are stored ENCRYPTED by the server (AES-256-GCM); only the server (service role) can read
-- or write this table — no client access at all.
create table if not exists google_calendar_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token_enc text not null,
  email text,
  connected_at timestamptz not null default now()
);
alter table google_calendar_links enable row level security;
revoke all on google_calendar_links from anon, authenticated;
