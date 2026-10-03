-- NetworQ — notifications, blocking, full connection states, realtime sync.
-- Safe to re-run.

-- pg_net lets the database notify the app server (email delivery); absent in local test databases
do $$ begin create extension if not exists pg_net; exception when others then null; end $$;

-- ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null check (type in ('connection_request', 'connection_accepted', 'connection_declined', 'security', 'event', 'system')),
  title       text not null,
  body        text,
  data        jsonb not null default '{}'::jsonb,   -- { request_id, from_user, event_id, screen }
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
alter table notifications add column if not exists emailed_at timestamptz;
create unique index if not exists notifications_dedupe on notifications(user_id, dedupe_key) where dedupe_key is not null;
create index if not exists notifications_user_recent on notifications(user_id, created_at desc);
alter table notifications enable row level security;
drop policy if exists "Users read own notifications" on notifications;
create policy "Users read own notifications" on notifications for select using (user_id = auth.uid());
-- writes only through functions below

-- ── BLOCKING ──────────────────────────────────────────────────────────────────
create table if not exists blocks (
  blocker     uuid not null references auth.users(id) on delete cascade,
  blocked     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table blocks enable row level security;
drop policy if exists "Users read own blocks" on blocks;
create policy "Users read own blocks" on blocks for select using (blocker = auth.uid());

-- Connection request states: pending → accepted | declined | cancelled
alter table connection_requests drop constraint if exists connection_requests_status_check;
alter table connection_requests add constraint connection_requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled'));

-- ── CONFIG (server hook URL + secret for email delivery; service role only) ───
create table if not exists app_config (key text primary key, value text not null);
alter table app_config enable row level security;  -- no policies: functions only

-- ── HELPERS ───────────────────────────────────────────────────────────────────
create or replace function radar_is_blocked(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker = p_a and blocked = p_b) or (blocker = p_b and blocked = p_a));
$$;

create or replace function radar_notify(p_user uuid, p_type text, p_title text, p_body text, p_data jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, type, title, body, data, dedupe_key)
  values (p_user, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb), p_dedupe)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

create or replace function radar_display_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(name), ''), 'A NetworQ member') from profiles where id = p_user;
$$;

-- ── CONNECTIONS ───────────────────────────────────────────────────────────────
create or replace function send_connection_request(p_event_id uuid, p_to_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r connection_requests;
  v_event text;
begin
  perform radar_require_member(p_event_id);
  if p_to_user = auth.uid() then raise exception 'cannot_connect_to_self'; end if;
  if not exists (select 1 from event_attendees where event_id = p_event_id and user_id = p_to_user) then
    raise exception 'not_a_member';
  end if;
  if radar_is_blocked(auth.uid(), p_to_user) then raise exception 'unavailable'; end if;
  if radar_are_connected(auth.uid(), p_to_user) then
    return jsonb_build_object('status', 'accepted', 'to_user', p_to_user, 'already_connected', true);
  end if;

  select * into r from connection_requests where event_id = p_event_id and from_user = auth.uid() and to_user = p_to_user;
  if found and r.status = 'declined' and r.responded_at > now() - interval '7 days' then
    return to_jsonb(r);  -- no re-asking for a week after a decline
  end if;

  insert into connection_requests (event_id, from_user, to_user) values (p_event_id, auth.uid(), p_to_user)
    on conflict (event_id, from_user, to_user)
    do update set status = 'pending', created_at = now(), responded_at = null
    where connection_requests.status in ('cancelled', 'declined')
    returning * into r;
  if r.id is null then
    select * into r from connection_requests where event_id = p_event_id and from_user = auth.uid() and to_user = p_to_user;
  end if;

  if r.status = 'pending' then
    select name into v_event from events where id = p_event_id;
    perform radar_notify(p_to_user, 'connection_request', radar_display_name(auth.uid()) || ' wants to connect',
      'At ' || coalesce(v_event, 'your event') || '. Accept to swap contact details.',
      jsonb_build_object('request_id', r.id, 'from_user', auth.uid(), 'event_id', p_event_id, 'screen', 'radar'),
      'req:' || r.id || ':' || extract(epoch from r.created_at)::bigint);
  end if;
  return to_jsonb(r);
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
  if p_accept and radar_is_blocked(r.from_user, r.to_user) then raise exception 'unavailable'; end if;

  update connection_requests
     set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
   where id = r.id returning * into r;

  select name into v_event_name from events where id = r.event_id;
  if p_accept then
    perform radar_contact_row(r.from_user, r.to_user, v_event_name);
    perform radar_contact_row(r.to_user, r.from_user, v_event_name);
    perform radar_notify(r.from_user, 'connection_accepted', radar_display_name(r.to_user) || ' accepted your request',
      'You''re connected — their details are in your contacts.',
      jsonb_build_object('request_id', r.id, 'from_user', r.to_user, 'event_id', r.event_id, 'screen', 'contacts'),
      'acc:' || r.id);
  else
    perform radar_notify(r.from_user, 'connection_declined', 'Connection request not accepted',
      radar_display_name(r.to_user) || ' isn''t connecting right now.',
      jsonb_build_object('request_id', r.id, 'event_id', r.event_id, 'screen', 'radar'),
      'dec:' || r.id);
  end if;
  -- the recipient's request notification is resolved
  update notifications set read_at = coalesce(read_at, now())
   where user_id = auth.uid() and type = 'connection_request' and data ->> 'request_id' = r.id::text;
  return to_jsonb(r);
end;
$$;

create or replace function cancel_connection_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r connection_requests;
begin
  update connection_requests set status = 'cancelled', responded_at = now()
   where id = p_request_id and from_user = auth.uid() and status = 'pending'
   returning * into r;
  if not found then raise exception 'request_not_found'; end if;
  delete from notifications where type = 'connection_request' and data ->> 'request_id' = r.id::text and read_at is null;
  return to_jsonb(r);
end;
$$;

create or replace function block_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_user = auth.uid() then raise exception 'cannot_block_self'; end if;
  insert into blocks (blocker, blocked) values (auth.uid(), p_user) on conflict do nothing;
  update connection_requests set status = 'cancelled', responded_at = now()
   where status = 'pending'
     and ((from_user = auth.uid() and to_user = p_user) or (from_user = p_user and to_user = auth.uid()));
  delete from notifications where user_id = auth.uid() and data ->> 'from_user' = p_user::text and read_at is null;
end;
$$;

create or replace function unblock_user(p_user uuid)
returns void language sql security definer set search_path = public as $$
  delete from blocks where blocker = auth.uid() and blocked = p_user;
$$;

create or replace function my_blocked_users()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', b.blocked, 'name', radar_display_name(b.blocked), 'blocked_at', b.created_at)
         order by b.created_at desc), '[]'::jsonb)
    from blocks b where b.blocker = auth.uid();
$$;

create or replace function mark_notifications_read(p_ids uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── RADAR: hide blocked pairs both ways ───────────────────────────────────────
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
     and a.radar_on and a.visible
     and not radar_is_blocked(auth.uid(), t.user_id);

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
     and a.radar_on and a.visible and a.last_seen_at > now() - interval '15 minutes'
     and not radar_is_blocked(auth.uid(), a.user_id);
  if not (v.radar_on and v.visible) then
    return jsonb_build_object('people', '[]'::jsonb, 'hidden_count', jsonb_array_length(v_people));
  end if;
  return jsonb_build_object('people', v_people, 'hidden_count', 0);
end;
$$;

-- ── NOTIFICATION PREFS: add connection emails ─────────────────────────────────
create or replace function update_notification_prefs(p_prefs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update profiles
     set notification_prefs = jsonb_build_object(
           'login_alerts',      coalesce((p_prefs ->> 'login_alerts')::boolean,      (notification_prefs ->> 'login_alerts')::boolean, true),
           'reminder_emails',   coalesce((p_prefs ->> 'reminder_emails')::boolean,   (notification_prefs ->> 'reminder_emails')::boolean, true),
           'product_updates',   coalesce((p_prefs ->> 'product_updates')::boolean,   (notification_prefs ->> 'product_updates')::boolean, false),
           'connection_emails', coalesce((p_prefs ->> 'connection_emails')::boolean, (notification_prefs ->> 'connection_emails')::boolean, true))
   where id = auth.uid()
   returning notification_prefs into v;
  return v;
end;
$$;

-- ── EMAIL DELIVERY: notify the server when a notification is created ──────────
-- Uses pg_net when available (Supabase); no-op elsewhere (e.g. local tests).
create or replace function notifications_dispatch()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  if to_regnamespace('net') is null then return new; end if;
  select value into v_url from app_config where key = 'notify_hook_url';
  select value into v_secret from app_config where key = 'notify_hook_secret';
  if v_url is null or v_secret is null then return new; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-NetworQ-Hook', v_secret),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;
drop trigger if exists notifications_dispatch on notifications;
create trigger notifications_dispatch after insert on notifications
  for each row when (new.type in ('connection_request', 'connection_accepted'))
  execute function notifications_dispatch();

-- ── GRANTS ────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['cancel_connection_request(uuid)', 'block_user(uuid)', 'unblock_user(uuid)',
                           'my_blocked_users()', 'mark_notifications_read(uuid[])'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['radar_is_blocked(uuid,uuid)', 'radar_notify(uuid,text,text,text,jsonb,text)',
                           'radar_display_name(uuid)', 'notifications_dispatch()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ── REALTIME: push changes to the parties instantly (RLS still applies) ───────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table notifications; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table connection_requests; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table contacts; exception when duplicate_object then null; end;
  end if;
end $$;
