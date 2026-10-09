-- Group calls (runs after 20261013_calls.sql / 20261014_release_hardening.sql)
--   • host + up to 5 connections (6 people), voice or video; peer-to-peer mesh (no media on our servers)
--   • host must be connected with, and not blocked by, every invitee
--   • invitees ring like 1:1 calls (Realtime + 'call' push notification)
--   • private Realtime channel gcall:<id> for members only (WebRTC signalling)
--   • the call ends when nobody is left in it

create table if not exists group_calls (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('audio', 'video')),
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create table if not exists group_call_members (
  call_id uuid not null references group_calls (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'ringing' check (status in ('ringing', 'joined', 'declined', 'left', 'missed')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  left_at timestamptz,
  primary key (call_id, user_id)
);
create index if not exists group_call_members_user_idx on group_call_members (user_id, invited_at desc);

alter table group_calls enable row level security;
alter table group_call_members enable row level security;

create or replace function group_call_member(p_call uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_call_members where call_id = p_call and user_id = auth.uid());
$$;

drop policy if exists "Members see their group calls" on group_calls;
create policy "Members see their group calls" on group_calls for select using (group_call_member(id));
drop policy if exists "Members see who's in the call" on group_call_members;
create policy "Members see who's in the call" on group_call_members for select using (group_call_member(call_id));
revoke all on group_calls, group_call_members from anon, authenticated;
grant select on group_calls, group_call_members to authenticated;

-- Start: invite 2–5 connections
create or replace function start_group_call(p_invitees uuid[], p_kind text default 'video')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_call group_calls;
  v_people uuid[];
  v_p uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_kind not in ('audio', 'video') then raise exception 'invalid_kind'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_people from unnest(p_invitees) x where x is not null and x <> v_uid;
  if array_length(v_people, 1) is null or array_length(v_people, 1) < 2 then raise exception 'too_few_people'; end if;
  if array_length(v_people, 1) > 5 then raise exception 'too_many_people'; end if;
  perform pg_advisory_xact_lock(hashtext('start_call:' || v_uid::text));
  if (select count(*) from group_calls where host_id = v_uid and created_at > now() - interval '5 minutes') >= 5 then
    raise exception 'rate_limited';
  end if;
  foreach v_p in array v_people loop
    if radar_is_blocked(v_uid, v_p) then raise exception 'unavailable'; end if;
    if not radar_are_connected(v_uid, v_p) then raise exception 'not_connected'; end if;
  end loop;

  insert into group_calls (host_id, kind) values (v_uid, p_kind) returning * into v_call;
  insert into group_call_members (call_id, user_id, status, joined_at) values (v_call.id, v_uid, 'joined', now());
  foreach v_p in array v_people loop
    insert into group_call_members (call_id, user_id) values (v_call.id, v_p);
    perform radar_notify(v_p, 'call', radar_display_name(v_uid),
                         case when p_kind = 'video' then 'Incoming group video call' else 'Incoming group call' end,
                         jsonb_build_object('screen', 'call', 'group_call_id', v_call.id, 'from_user', v_uid, 'kind', p_kind),
                         'gcall:' || v_call.id);
  end loop;
  return to_jsonb(v_call);
end;
$$;

-- Join (members only, while active and still ringing/joined; rings last 60 s)
create or replace function join_group_call(p_call_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_call group_calls;
  v_m group_call_members;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_call from group_calls where id = p_call_id;
  select * into v_m from group_call_members where call_id = p_call_id and user_id = v_uid for update;
  if v_call.id is null or v_m.user_id is null then raise exception 'not_found'; end if;
  if v_call.status <> 'active' then return jsonb_build_object('status', 'ended'); end if;
  if radar_is_blocked(v_call.host_id, v_uid) then raise exception 'unavailable'; end if;
  update group_call_members set status = 'joined', joined_at = coalesce(joined_at, now()), left_at = null
   where call_id = p_call_id and user_id = v_uid;
  update notifications set read_at = coalesce(read_at, now()) where user_id = v_uid and dedupe_key = 'gcall:' || p_call_id;
  return jsonb_build_object('status', 'joined', 'kind', v_call.kind, 'host_id', v_call.host_id);
end;
$$;

-- Decline / leave; the call ends when nobody is in it
create or replace function leave_group_call(p_call_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_m group_call_members;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_m from group_call_members where call_id = p_call_id and user_id = v_uid for update;
  if v_m.user_id is null then raise exception 'not_found'; end if;
  update group_call_members
     set status = case when v_m.status = 'ringing' then 'declined' else 'left' end, left_at = now()
   where call_id = p_call_id and user_id = v_uid;
  if not exists (select 1 from group_call_members where call_id = p_call_id and status = 'joined') then
    update group_calls set status = 'ended', ended_at = now() where id = p_call_id and status = 'active';
    update group_call_members set status = 'missed' where call_id = p_call_id and status = 'ringing';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function start_group_call(uuid[], text), join_group_call(uuid), leave_group_call(uuid), group_call_member(uuid) from public, anon;
grant execute on function start_group_call(uuid[], text), join_group_call(uuid), leave_group_call(uuid), group_call_member(uuid) to authenticated;

-- Private signalling channel gcall:<id> for members (extends the existing topic check)
create or replace function realtime_topic_allowed(p_topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  a uuid;
  b uuid;
begin
  if auth.uid() is null or p_topic is null then return false; end if;
  if p_topic like 'chat:%' then
    return exists (select 1 from direct_chats c
                    where c.id::text = substr(p_topic, 6)
                      and (c.user1_id = auth.uid() or c.user2_id = auth.uid())
                      and not radar_is_blocked(c.user1_id, c.user2_id));
  elsif p_topic like 'call:%' then
    begin
      a := split_part(substr(p_topic, 6), '_', 1)::uuid;
      b := split_part(substr(p_topic, 6), '_', 2)::uuid;
    exception when others then
      return false;
    end;
    return auth.uid() in (a, b) and radar_are_connected(a, b) and not radar_is_blocked(a, b);
  elsif p_topic like 'gcall:%' then
    begin
      a := substr(p_topic, 7)::uuid;
    exception when others then
      return false;
    end;
    return exists (select 1 from group_call_members m join group_calls g on g.id = m.call_id
                    where m.call_id = a and m.user_id = auth.uid() and g.status = 'active');
  end if;
  return false;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table group_call_members; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table group_calls; exception when duplicate_object then null; end;
  end if;
end;
$$;
