-- Waitlist admin (runs after 20261001b_restore_waitlist_and_storage.sql)
--   • sign-up details: where they came from (UTM / referrer), referral code + who referred them,
--     device, time zone; admin status (waiting → invited → joined), notes, tags, email errors
--   • admin_users (extra admins, scrypt hashes) and admin_audit (who did what) — server only
--   • admin_waitlist_sync_joined(): marks waitlisters who created an app account as "joined"
--   • admin_app_stats(): app usage numbers for the admin panel
-- Everything here is service-role only; anon / authenticated get no access. Additive and re-runnable.

-- 1. Sign-up details
alter table waitlist add column if not exists status text not null default 'waiting';
alter table waitlist add column if not exists invited_at timestamptz;
alter table waitlist add column if not exists joined_at timestamptz;
alter table waitlist add column if not exists notes text;
alter table waitlist add column if not exists tags text[] not null default '{}';
alter table waitlist add column if not exists source text;
alter table waitlist add column if not exists utm_source text;
alter table waitlist add column if not exists utm_medium text;
alter table waitlist add column if not exists utm_campaign text;
alter table waitlist add column if not exists referrer text;
alter table waitlist add column if not exists ref_code text;
alter table waitlist add column if not exists referred_by text;
alter table waitlist add column if not exists device text;
alter table waitlist add column if not exists timezone text;
alter table waitlist add column if not exists email_error text;
alter table waitlist add column if not exists email_attempts integer not null default 0;
alter table waitlist add column if not exists last_emailed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'waitlist_status_check') then
    alter table waitlist add constraint waitlist_status_check check (status in ('waiting', 'invited', 'joined'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waitlist_notes_len') then
    alter table waitlist add constraint waitlist_notes_len check (notes is null or char_length(notes) <= 4000);
  end if;
end;
$$;

-- Every sign-up gets a short referral code (existing rows too)
update waitlist set ref_code = substr(md5(id::text || clock_timestamp()::text), 1, 8) where ref_code is null;
alter table waitlist alter column ref_code set default substr(md5(gen_random_uuid()::text), 1, 8);
create unique index if not exists waitlist_ref_code_key on waitlist (ref_code);
create index if not exists waitlist_created_at_idx on waitlist (created_at desc);
create index if not exists waitlist_referred_by_idx on waitlist (referred_by);

-- join_waitlist also returns the referral code (for the share link)
create or replace function join_waitlist(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email    text := lower(trim(p_email));
  v_position int;
  v_code     text;
  v_count    int;
  v_exists   boolean := false;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using hint = 'Please enter a valid email address.';
  end if;

  select position, ref_code into v_position, v_code from waitlist where email = v_email;
  if found then
    v_exists := true;
  else
    begin
      v_position := nextval('waitlist_position_seq');
      insert into waitlist (email, position) values (v_email, v_position) returning ref_code into v_code;
    exception when unique_violation then
      select position, ref_code into v_position, v_code from waitlist where email = v_email;
      v_exists := true;
    end;
  end if;

  select count(*) into v_count from waitlist;
  return jsonb_build_object('already_exists', v_exists, 'position', v_position, 'ref_code', v_code, 'show_position', v_count >= 20);
end;
$$;
revoke execute on function join_waitlist(text) from public;
grant execute on function join_waitlist(text) to anon, authenticated;

-- 2. Admins + audit log (server only)
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9._-]{3,40}$'),
  password_hash text not null,
  created_by text,
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  last_login_at timestamptz
);
create table if not exists admin_audit (
  id bigserial primary key,
  admin text not null,
  action text not null,
  target text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on admin_audit (created_at desc);
alter table admin_users enable row level security;
alter table admin_audit enable row level security;
revoke all on admin_users, admin_audit from anon, authenticated;
revoke all on waitlist from anon, authenticated;

-- 3. Waitlisters who created an app account → "joined"
create or replace function admin_waitlist_sync_joined()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update waitlist w
     set status = 'joined', joined_at = coalesce(w.joined_at, now())
    from auth.users u
   where lower(u.email) = w.email and w.status <> 'joined';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 4. App usage numbers (each count is skipped, not failed, if a table is missing)
create or replace function admin_safe_count(p_sql text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  execute p_sql into n;
  return coalesce(n, 0);
exception when undefined_table or undefined_column then
  return null;
end;
$$;

create or replace function admin_app_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active7 bigint;
  v_active30 bigint;
  v_ai jsonb;
begin
  -- "active" = did something in the app: added a contact, sent a message, made a call, used AI, was at an event
  select count(distinct uid) into v_active7 from (
    select user_id as uid from contacts where added_at > now() - interval '7 days'
    union all select sender_id from chat_messages where created_at > now() - interval '7 days'
    union all select caller_id from calls where created_at > now() - interval '7 days'
    union all select user_id from ai_usage where used_date > current_date - 7
    union all select user_id from event_attendees where last_seen_at > now() - interval '7 days'
  ) a;
  select count(distinct uid) into v_active30 from (
    select user_id as uid from contacts where added_at > now() - interval '30 days'
    union all select sender_id from chat_messages where created_at > now() - interval '30 days'
    union all select caller_id from calls where created_at > now() - interval '30 days'
    union all select user_id from ai_usage where used_date > current_date - 30
    union all select user_id from event_attendees where last_seen_at > now() - interval '30 days'
  ) a;
  select coalesce(jsonb_object_agg(action, n), '{}'::jsonb) into v_ai
    from (select action, sum(count) as n from ai_usage where used_date > current_date - 30 group by action) x;

  return jsonb_build_object(
    'users_total',        admin_safe_count('select count(*) from auth.users'),
    'users_new_7d',       admin_safe_count($q$select count(*) from auth.users where created_at > now() - interval '7 days'$q$),
    'active_7d',          v_active7,
    'active_30d',         v_active30,
    'contacts_total',     admin_safe_count('select count(*) from contacts'),
    'contacts_7d',        admin_safe_count($q$select count(*) from contacts where added_at > now() - interval '7 days'$q$),
    'messages_7d',        admin_safe_count($q$select count(*) from chat_messages where created_at > now() - interval '7 days'$q$),
    'calls_7d',           admin_safe_count($q$select count(*) from calls where created_at > now() - interval '7 days'$q$),
    'calls_answered_7d',  admin_safe_count($q$select count(*) from calls where created_at > now() - interval '7 days' and answered_at is not null$q$),
    'group_calls_7d',     admin_safe_count($q$select count(*) from group_calls where created_at > now() - interval '7 days'$q$),
    'events_total',       admin_safe_count('select count(*) from events'),
    'events_user_30d',    admin_safe_count($q$select count(*) from events where source = 'user' and created_at > now() - interval '30 days'$q$),
    'event_checkins_30d', admin_safe_count($q$select count(*) from event_attendees where joined_at > now() - interval '30 days'$q$),
    'public_events_upcoming', admin_safe_count($q$select count(*) from public_events where starts_at > now()$q$),
    'ai_30d',             v_ai
  );
end;
$$;

revoke all on function admin_waitlist_sync_joined(), admin_safe_count(text), admin_app_stats() from public, anon, authenticated;
grant execute on function admin_waitlist_sync_joined(), admin_app_stats() to service_role;
