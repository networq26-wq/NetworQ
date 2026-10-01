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
