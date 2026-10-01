-- NetworQ: all pending migrations in order (APPLIED to production 2026-10-01). Safe to re-run.


-- ════════ 20261001_security_hardening.sql ════════
-- NetworQ security hardening — run once in the Supabase SQL editor.
-- Fixes found by tests/integration/supabase-rls.test.js:
--   1. Users could UPDATE their own ai_usage rows and reset their daily AI quota.
--   2. increment_ai_usage trusted the caller-supplied p_user_id (SECURITY DEFINER).
--   3. Adds an 'email_send' daily cap so /api/email cannot be used for bulk spam.

-- 0. The live project never received this table from schema.sql — create it if missing
create table if not exists ai_usage (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  action      text not null,
  used_date   date not null default current_date,
  count       integer not null default 0,
  unique (user_id, action, used_date)
);
alter table ai_usage enable row level security;
drop policy if exists "Users can read own ai_usage" on ai_usage;
create policy "Users can read own ai_usage" on ai_usage for select using (auth.uid() = user_id);

-- 1. Usage rows are written only by increment_ai_usage (security definer)
drop policy if exists "Users can insert own ai_usage" on ai_usage;
drop policy if exists "Users can update own ai_usage" on ai_usage;

-- 3. Allow the new action
alter table ai_usage drop constraint if exists ai_usage_action_check;
alter table ai_usage add constraint ai_usage_action_check
  check (action in ('email_generation', 'card_scan', 'email_send'));

-- 2. Bind the counter to the authenticated caller
create or replace function increment_ai_usage(p_user_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit    integer;
  v_count    integer;
  v_allowed  boolean;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Not allowed to update usage for another user';
  end if;

  if p_action = 'email_generation' then
    v_limit := 5;
  elsif p_action = 'card_scan' then
    v_limit := 10;
  elsif p_action = 'email_send' then
    v_limit := 50;
  else
    raise exception 'Unknown action: %', p_action;
  end if;

  insert into ai_usage (user_id, action, used_date, count)
    values (p_user_id, p_action, current_date, 1)
  on conflict (user_id, action, used_date)
    do update set count = ai_usage.count + 1;

  select count into v_count
    from ai_usage
   where user_id = p_user_id
     and action  = p_action
     and used_date = current_date;

  v_allowed := v_count <= v_limit;

  if not v_allowed then
    update ai_usage
       set count = v_limit
     where user_id   = p_user_id
       and action     = p_action
       and used_date  = current_date;
  end if;

  return jsonb_build_object(
    'allowed',    v_allowed,
    'used',       least(v_count, v_limit),
    'limit',      v_limit,
    'remaining',  greatest(v_limit - least(v_count, v_limit), 0)
  );
end;
$$;

revoke execute on function increment_ai_usage(uuid, text) from public, anon;
grant  execute on function increment_ai_usage(uuid, text) to authenticated, service_role;

-- Let users clean up their own history (contact deletes already cascade)
drop policy if exists "Users can delete own emails" on follow_up_emails;
create policy "Users can delete own emails"
  on follow_up_emails for delete using (auth.uid() = user_id);
drop policy if exists "Users can delete own meetings" on meetings;
create policy "Users can delete own meetings"
  on meetings for delete using (auth.uid() = user_id);


-- ════════ 20261001b_restore_waitlist_and_storage.sql ════════
-- NetworQ — restore objects that schema.sql defines but the live project is missing.
-- Found by the live audit on 2026-10-01:
--   * join_waitlist() does not exist  → every waitlist sign-up fails
--   * the card-images storage bucket does not exist → card photo uploads fail
--     and photos fall back to multi-MB data URLs stored in contacts.image
-- Safe to re-run.

-- ── WAITLIST ──────────────────────────────────────────────────────────────────
create sequence if not exists waitlist_position_seq;

create table if not exists waitlist (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null unique,
  created_at timestamptz default now(),
  notified   boolean     default false,
  position   int         not null          -- set explicitly by join_waitlist, never via column default
);

-- RLS on; anonymous visitors sign up only through join_waitlist()
alter table waitlist enable row level security;

-- No direct insert policy: sign-ups go through join_waitlist (security definer),
-- which validates the email and assigns the position.
drop policy if exists "Anyone can join waitlist" on waitlist;

-- Returns {already_exists: boolean, position: int, show_position: boolean}
-- show_position is false until the waitlist has at least 20 signups.
--
-- Sequence safety: nextval() is only called when we are certain the email is
-- new, so duplicate submissions never advance the sequence or burn a number.
-- Race condition (two concurrent new signups for the same email): the inner
-- BEGIN/EXCEPTION block catches the unique_violation that would otherwise
-- surface as an error, re-fetches the winner's row, and returns already_exists:
-- true. One sequence number is burned in that rare case — accepted tradeoff.
create or replace function join_waitlist(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email    text := lower(trim(p_email));
  v_position int;
  v_count    int;
begin
  -- Server-side email format guard (can't be bypassed via direct RPC)
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using hint = 'Please enter a valid email address.';
  end if;

  -- Check existence first — never touch the sequence for a duplicate
  select position into v_position
    from waitlist
   where email = v_email;

  if found then
    select count(*) into v_count from waitlist;
    return jsonb_build_object(
      'already_exists', true,
      'position',       v_position,
      'show_position',  v_count >= 20
    );
  end if;

  -- New email: claim the next position then insert
  begin
    v_position := nextval('waitlist_position_seq');
    insert into waitlist (email, position)
      values (v_email, v_position);
  exception when unique_violation then
    -- Another session won the race and inserted this email between our
    -- SELECT and INSERT. Fetch their row and return as an existing signup.
    select position into v_position
      from waitlist
     where email = v_email;

    select count(*) into v_count from waitlist;
    return jsonb_build_object(
      'already_exists', true,
      'position',       v_position,
      'show_position',  v_count >= 20
    );
  end;

  select count(*) into v_count from waitlist;
  return jsonb_build_object(
    'already_exists', false,
    'position',       v_position,
    'show_position',  v_count >= 20
  );
end;
$$;

revoke execute on function join_waitlist(text) from public;
grant  execute on function join_waitlist(text) to   anon, authenticated;

-- ── CARD IMAGE STORAGE ────────────────────────────────────────────────────────
-- Public bucket: files are readable by their (unguessable) URL, which the app
-- shares in emails. Listing is NOT public — only owners can enumerate their folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload own card images" on storage.objects;
create policy "Users can upload own card images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update own card images" on storage.objects;
create policy "Users can update own card images"
  on storage.objects for update to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete own card images" on storage.objects;
create policy "Users can delete own card images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- Replaces the old "public read" select policy, which let anyone list every user's cards
drop policy if exists "Public read access for card images" on storage.objects;
drop policy if exists "Users can list own card images" on storage.objects;
create policy "Users can list own card images"
  on storage.objects for select to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);


-- ════════ 20261002_event_radar.sql ════════
-- NetworQ Event Radar — events, attendance, rotating BLE tokens, connection requests.
-- Spec: docs/superpowers/specs/2026-10-01-event-radar-design.md
-- All trust decisions live in the security-definer functions below; tables expose
-- only what each user may see through RLS. Safe to re-run.

-- ── TABLES ────────────────────────────────────────────────────────────────────
create table if not exists events (
  id           uuid primary key default gen_random_uuid(),
  external_id  text unique,                         -- Events Hub id for listed events
  name         text not null check (char_length(name) between 2 and 120),
  venue        text check (char_length(venue) <= 160),
  starts_at    timestamptz,
  ends_at      timestamptz,
  join_code    text unique,                         -- NQ-XXXXXX for user-created events
  source       text not null default 'user' check (source in ('listed', 'user')),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists event_attendees (
  event_id       uuid not null references events(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  joined_at      timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  radar_on       boolean not null default true,
  visible        boolean not null default true,
  show_distance  boolean not null default true,
  show_profile   boolean not null default true,
  primary key (event_id, user_id)
);
create index if not exists event_attendees_user_idx on event_attendees(user_id);

create table if not exists radar_tokens (
  token       text primary key check (token ~ '^[0-9a-f]{16}$'),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_id    uuid not null references events(id) on delete cascade,
  expires_at  timestamptz not null
);
create index if not exists radar_tokens_event_idx on radar_tokens(event_id, expires_at);

create table if not exists connection_requests (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  from_user     uuid not null references auth.users(id) on delete cascade,
  to_user       uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  unique (event_id, from_user, to_user),
  check (from_user <> to_user)
);

create table if not exists event_join_failures (
  user_id  uuid not null references auth.users(id) on delete cascade,
  day      date not null default current_date,
  count    int  not null default 0,
  primary key (user_id, day)
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table events              enable row level security;
alter table event_attendees     enable row level security;
alter table radar_tokens        enable row level security;  -- no policies: functions only
alter table connection_requests enable row level security;
alter table event_join_failures enable row level security;  -- no policies: functions only

drop policy if exists "Members can read their events" on events;
create policy "Members can read their events" on events for select using (
  created_by = auth.uid()
  or exists (select 1 from event_attendees a where a.event_id = events.id and a.user_id = auth.uid())
);

drop policy if exists "Users read own attendance" on event_attendees;
create policy "Users read own attendance" on event_attendees for select using (user_id = auth.uid());

drop policy if exists "Parties read their requests" on connection_requests;
create policy "Parties read their requests" on connection_requests for select
  using (from_user = auth.uid() or to_user = auth.uid());

-- ── HELPERS ───────────────────────────────────────────────────────────────────
create or replace function radar_random_hex16()
returns text language sql volatile set search_path = public as $$
  -- 64 bits from two v4 UUIDs, skipping the fixed version nibble
  select substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) ||
         substr(replace(gen_random_uuid()::text, '-', ''), 14, 4);
$$;

create or replace function radar_event_json(e events)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'venue', e.venue, 'starts_at', e.starts_at,
    'ends_at', e.ends_at, 'join_code', e.join_code, 'source', e.source,
    'external_id', e.external_id, 'is_owner', e.created_by = auth.uid()
  );
$$;

create or replace function radar_require_member(p_event_id uuid)
returns event_attendees language plpgsql stable security definer set search_path = public as $$
declare v event_attendees;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v from event_attendees where event_id = p_event_id and user_id = auth.uid();
  if not found then raise exception 'not_a_member'; end if;
  return v;
end;
$$;

create or replace function radar_public_profile(p_user uuid, p_show_profile boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_show_profile then
    jsonb_build_object('name', coalesce(p.name, 'NetworQ attendee'), 'title', p.role,
                       'company', p.company, 'avatar', to_jsonb(p) ->> 'avatar_url')
  else
    jsonb_build_object('name', coalesce(split_part(p.name, ' ', 1), 'Attendee'), 'title', p.role,
                       'company', null, 'avatar', null)
  end
  from profiles p where p.id = p_user;
$$;

-- ── EVENTS & MEMBERSHIP ───────────────────────────────────────────────────────
create or replace function create_event(p_name text, p_venue text default null,
                                        p_starts_at timestamptz default null, p_ends_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_event events;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  for attempt in 1..8 loop
    v_code := 'NQ-' || (select string_agg(substr(v_alphabet, 1 + floor(random() * 31)::int, 1), '')
                        from generate_series(1, 6));
    begin
      insert into events (name, venue, starts_at, ends_at, join_code, source, created_by)
        values (trim(p_name), nullif(trim(p_venue), ''), p_starts_at, p_ends_at, v_code, 'user', auth.uid())
        returning * into v_event;
      exit;
    exception when unique_violation then
      if attempt = 8 then raise; end if;
    end;
  end loop;
  insert into event_attendees (event_id, user_id) values (v_event.id, auth.uid());
  return radar_event_json(v_event);
end;
$$;

create or replace function join_event_by_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event events;
  v_fail int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select count into v_fail from event_join_failures where user_id = auth.uid() and day = current_date;
  if coalesce(v_fail, 0) >= 30 then raise exception 'too_many_attempts'; end if;

  select * into v_event from events where join_code = upper(regexp_replace(trim(p_code), '\s', '', 'g'));
  if not found then
    -- Return instead of raising: an exception would roll back the failure counter
    insert into event_join_failures (user_id, count) values (auth.uid(), 1)
      on conflict (user_id, day) do update set count = event_join_failures.count + 1;
    return jsonb_build_object('error', 'invalid_code');
  end if;
  insert into event_attendees (event_id, user_id) values (v_event.id, auth.uid())
    on conflict (event_id, user_id) do update set last_seen_at = now();
  return radar_event_json(v_event);
end;
$$;

create or replace function join_listed_event(p_external_id text, p_name text,
                                             p_venue text default null, p_starts_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_event events;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into events (external_id, name, venue, starts_at, source, created_by)
    values (p_external_id, trim(p_name), p_venue, p_starts_at, 'listed', auth.uid())
    on conflict (external_id) do update set external_id = excluded.external_id
    returning * into v_event;
  insert into event_attendees (event_id, user_id) values (v_event.id, auth.uid())
    on conflict (event_id, user_id) do update set last_seen_at = now();
  return radar_event_json(v_event);
end;
$$;

create or replace function leave_event(p_event_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from radar_tokens where event_id = p_event_id and user_id = auth.uid();
  delete from event_attendees where event_id = p_event_id and user_id = auth.uid();
end;
$$;

create or replace function my_events()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(radar_event_json(e) || jsonb_build_object(
           'attendee_count', (select count(*) from event_attendees x where x.event_id = e.id),
           'settings', jsonb_build_object('radar_on', a.radar_on, 'visible', a.visible,
                                          'show_distance', a.show_distance, 'show_profile', a.show_profile))
         order by a.joined_at desc), '[]'::jsonb)
  from event_attendees a join events e on e.id = a.event_id
  where a.user_id = auth.uid();
$$;

create or replace function update_radar_settings(p_event_id uuid, p_radar_on boolean, p_visible boolean,
                                                 p_show_distance boolean, p_show_profile boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v event_attendees;
begin
  perform radar_require_member(p_event_id);
  update event_attendees
     set radar_on = p_radar_on, visible = p_visible, show_distance = p_show_distance,
         show_profile = p_show_profile, last_seen_at = now()
   where event_id = p_event_id and user_id = auth.uid()
   returning * into v;
  if not (p_radar_on and p_visible) then
    delete from radar_tokens where event_id = p_event_id and user_id = auth.uid();
  end if;
  return jsonb_build_object('radar_on', v.radar_on, 'visible', v.visible,
                            'show_distance', v.show_distance, 'show_profile', v.show_profile);
end;
$$;

-- ── RADAR ─────────────────────────────────────────────────────────────────────
create or replace function issue_radar_token(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v event_attendees;
  v_token text;
  v_exp timestamptz := now() + interval '15 minutes';
begin
  v := radar_require_member(p_event_id);
  update event_attendees set last_seen_at = now() where event_id = p_event_id and user_id = auth.uid();
  if not v.radar_on then raise exception 'radar_off'; end if;
  delete from radar_tokens where expires_at < now() - interval '1 hour';  -- housekeeping
  if not v.visible then
    return jsonb_build_object('token', null, 'expires_at', v_exp);
  end if;
  loop
    v_token := radar_random_hex16();
    begin
      insert into radar_tokens (token, user_id, event_id, expires_at) values (v_token, auth.uid(), p_event_id, v_exp);
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end;
$$;

create or replace function resolve_radar_tokens(p_event_id uuid, p_tokens text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v event_attendees;
  v_people jsonb;
begin
  v := radar_require_member(p_event_id);
  if not v.radar_on then raise exception 'radar_off'; end if;
  if coalesce(array_length(p_tokens, 1), 0) > 64 then raise exception 'too_many_tokens'; end if;

  select coalesce(jsonb_agg(radar_public_profile(t.user_id, a.show_profile) || jsonb_build_object(
           'token', t.token, 'user_id', t.user_id, 'show_distance', a.show_distance, 'expires_at', t.expires_at)), '[]'::jsonb)
    into v_people
    from radar_tokens t
    join event_attendees a on a.event_id = t.event_id and a.user_id = t.user_id
   where t.event_id = p_event_id
     and t.token = any (p_tokens)
     and t.expires_at > now()
     and t.user_id <> auth.uid()
     and a.radar_on and a.visible;

  -- To see people you must be seen: incognito callers get a count only
  if not v.visible then
    return jsonb_build_object('people', '[]'::jsonb, 'hidden_count', jsonb_array_length(v_people));
  end if;
  return jsonb_build_object('people', v_people, 'hidden_count', 0);
end;
$$;

create or replace function list_event_attendees(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v event_attendees;
  v_people jsonb;
begin
  v := radar_require_member(p_event_id);
  update event_attendees set last_seen_at = now() where event_id = p_event_id and user_id = auth.uid();
  select coalesce(jsonb_agg(radar_public_profile(a.user_id, a.show_profile) || jsonb_build_object(
           'user_id', a.user_id, 'show_distance', false) order by a.last_seen_at desc), '[]'::jsonb)
    into v_people
    from event_attendees a
   where a.event_id = p_event_id and a.user_id <> auth.uid()
     and a.radar_on and a.visible and a.last_seen_at > now() - interval '15 minutes';
  if not (v.radar_on and v.visible) then
    return jsonb_build_object('people', '[]'::jsonb, 'hidden_count', jsonb_array_length(v_people));
  end if;
  return jsonb_build_object('people', v_people, 'hidden_count', 0);
end;
$$;

-- ── CONNECTIONS ───────────────────────────────────────────────────────────────
create or replace function send_connection_request(p_event_id uuid, p_to_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r connection_requests;
begin
  perform radar_require_member(p_event_id);
  if p_to_user = auth.uid() then raise exception 'cannot_connect_to_self'; end if;
  if not exists (select 1 from event_attendees where event_id = p_event_id and user_id = p_to_user) then
    raise exception 'not_a_member';
  end if;
  insert into connection_requests (event_id, from_user, to_user) values (p_event_id, auth.uid(), p_to_user)
    on conflict (event_id, from_user, to_user) do update set event_id = excluded.event_id
    returning * into r;
  return to_jsonb(r);
end;
$$;

create or replace function my_connection_requests(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform radar_require_member(p_event_id);
  return jsonb_build_object(
    'incoming', coalesce((select jsonb_agg(radar_public_profile(r.from_user, true) || jsonb_build_object(
                    'id', r.id, 'from_user', r.from_user, 'created_at', r.created_at) order by r.created_at desc)
                  from connection_requests r
                 where r.event_id = p_event_id and r.to_user = auth.uid() and r.status = 'pending'), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'to_user', r.to_user, 'status', r.status))
                  from connection_requests r
                 where r.event_id = p_event_id and r.from_user = auth.uid()), '[]'::jsonb)
  );
end;
$$;

create or replace function radar_contact_row(p_owner uuid, p_person uuid, p_event_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into contacts (user_id, name, title, company, email, phone, linkedin, event, reference, reminder_done, email_sent, tags)
  select p_owner, coalesce(p.name, 'NetworQ attendee'), p.role, p.company, u.email, p.phone, p.linkedin,
         p_event_name, 'NetworQ Radar', false, false, array['radar']
    from auth.users u left join profiles p on p.id = u.id
   where u.id = p_person;
end;
$$;

create or replace function respond_connection_request(p_request_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r connection_requests;
  v_event_name text;
begin
  select * into r from connection_requests where id = p_request_id and to_user = auth.uid() for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.status <> 'pending' then return to_jsonb(r); end if;

  update connection_requests
     set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
   where id = r.id returning * into r;

  if p_accept then
    select name into v_event_name from events where id = r.event_id;
    perform radar_contact_row(r.from_user, r.to_user, v_event_name);
    perform radar_contact_row(r.to_user, r.from_user, v_event_name);
  end if;
  return to_jsonb(r);
end;
$$;

-- ── GRANTS ────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'create_event(text,text,timestamptz,timestamptz)', 'join_event_by_code(text)',
    'join_listed_event(text,text,text,timestamptz)', 'leave_event(uuid)', 'my_events()',
    'update_radar_settings(uuid,boolean,boolean,boolean,boolean)', 'issue_radar_token(uuid)',
    'resolve_radar_tokens(uuid,text[])', 'list_event_attendees(uuid)',
    'send_connection_request(uuid,uuid)', 'my_connection_requests(uuid)',
    'respond_connection_request(uuid,boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'radar_require_member(uuid)', 'radar_public_profile(uuid,boolean)',
    'radar_contact_row(uuid,uuid,text)', 'radar_random_hex16()', 'radar_event_json(events)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;


-- ════════ 20261003_account_email_events.sql ════════
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


-- ════════ 20261003b_avatars_storage.sql ════════
-- Public avatars bucket; users write only inside their own folder ({uid}/...).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own avatar" on storage.objects;
create policy "Users upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users update own avatar" on storage.objects;
create policy "Users update own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete own avatar" on storage.objects;
create policy "Users delete own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
