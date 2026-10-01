-- NetworQ — account settings, security notifications, honest events.
-- Spec: docs/superpowers/specs/2026-10-01-account-email-events-design.md. Safe to re-run.

-- ── PROFILE ADDITIONS ─────────────────────────────────────────────────────────
alter table profiles add column if not exists avatar_url text;
alter table profiles add column if not exists notification_prefs jsonb not null
  default '{"login_alerts": true, "reminder_emails": true, "product_updates": false}'::jsonb;
alter table profiles add column if not exists deletion_scheduled_at timestamptz;

-- ── LOGIN DEVICES (new sign-in alerts) ────────────────────────────────────────
create table if not exists login_devices (
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_hash  text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  user_agent   text,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  primary key (user_id, device_hash)
);
alter table login_devices enable row level security;
drop policy if exists "Users read own devices" on login_devices;
create policy "Users read own devices" on login_devices for select using (user_id = auth.uid());
-- writes: server (service role) only

-- ── PUBLIC EVENTS (imported from real source pages only) ──────────────────────
create table if not exists public_events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 2 and 200),
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  venue        text,
  city         text,
  url          text not null unique check (url ~ '^https?://'),
  source_host  text not null,
  image        text,
  description  text check (char_length(description) <= 4000),
  organizer    text,
  created_by   uuid references auth.users(id) on delete set null,
  verified     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists public_events_starts_idx on public_events(starts_at);
alter table public_events enable row level security;
drop policy if exists "Signed-in users read events" on public_events;
create policy "Signed-in users read events" on public_events for select to authenticated using (true);
-- writes: server (service role) only, after extracting data from the source page

-- ── SESSION REVOCATION ("this wasn't me") ─────────────────────────────────────
create or replace function revoke_all_sessions(p_user_id uuid)
returns int language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function revoke_all_sessions(uuid) from public, anon, authenticated;
grant execute on function revoke_all_sessions(uuid) to service_role;

-- ── NOTIFICATION PREFS (validated update) ─────────────────────────────────────
create or replace function update_notification_prefs(p_prefs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update profiles
     set notification_prefs = jsonb_build_object(
           'login_alerts',    coalesce((p_prefs ->> 'login_alerts')::boolean,    (notification_prefs ->> 'login_alerts')::boolean, true),
           'reminder_emails', coalesce((p_prefs ->> 'reminder_emails')::boolean, (notification_prefs ->> 'reminder_emails')::boolean, true),
           'product_updates', coalesce((p_prefs ->> 'product_updates')::boolean, (notification_prefs ->> 'product_updates')::boolean, false))
   where id = auth.uid()
   returning notification_prefs into v;
  return v;
end;
$$;
revoke all on function update_notification_prefs(jsonb) from public, anon;
grant execute on function update_notification_prefs(jsonb) to authenticated;

-- deletion_scheduled_at is set/cleared only by the server (service role):
-- users must not be able to cancel or schedule via direct profile updates.
create or replace function protect_deletion_column()
returns trigger language plpgsql as $$
begin
  -- PostgREST runs user requests as role "authenticated" (claims JSON on newer versions)
  if (current_user = 'authenticated'
      or current_setting('request.jwt.claim.role', true) = 'authenticated'
      or coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role' = 'authenticated')
     and new.deletion_scheduled_at is distinct from old.deletion_scheduled_at then
    new.deletion_scheduled_at := old.deletion_scheduled_at;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_deletion_column on profiles;
create trigger protect_deletion_column before update on profiles
  for each row execute function protect_deletion_column();
