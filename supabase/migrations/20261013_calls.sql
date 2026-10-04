-- Calls that ring anywhere (runs after 20261012_chat_hardening.sql)
--   • a call is a row in `calls`: the callee's app sees it live (Realtime) on any screen,
--     and a 'call' notification reaches the phone as a push when the app is closed
--   • only connected, unblocked people can call each other; 10 calls / 5 minutes per caller
--   • written only through start_call / answer_call / end_call (no direct writes)
--   • media itself never touches the database: WebRTC signalling stays on the private
--     call:<user1>_<user2> channel (already restricted to the two people)

-- 1. Notifications can be about calls
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('connection_request', 'connection_accepted', 'connection_declined', 'reminder', 'message', 'call', 'security', 'event', 'system'));

-- 2. Calls
create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references auth.users (id) on delete cascade,
  callee_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('audio', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'accepted', 'declined', 'missed', 'cancelled', 'ended')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);
create index if not exists calls_callee_idx on calls (callee_id, created_at desc);
create index if not exists calls_caller_idx on calls (caller_id, created_at desc);

alter table calls enable row level security;
drop policy if exists "Participants can see their calls" on calls;
create policy "Participants can see their calls" on calls
  for select using (auth.uid() = caller_id or auth.uid() = callee_id);
revoke insert, update, delete on calls from anon, authenticated;

-- A ring lasts 45 seconds
create or replace function call_ring_expired(p_call calls)
returns boolean language sql immutable as $$
  select p_call.status = 'ringing' and p_call.created_at < now() - interval '45 seconds';
$$;

-- 3. Start a call
create or replace function start_call(p_callee uuid, p_kind text default 'audio')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_call calls;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_kind not in ('audio', 'video') then raise exception 'invalid_kind'; end if;
  if p_callee is null or p_callee = v_uid then raise exception 'invalid_recipient'; end if;
  if radar_is_blocked(v_uid, p_callee) then raise exception 'unavailable'; end if;
  if not radar_are_connected(v_uid, p_callee) then raise exception 'not_connected'; end if;
  if (select count(*) from calls where caller_id = v_uid and created_at > now() - interval '5 minutes') >= 10 then
    raise exception 'rate_limited';
  end if;

  -- Anything of mine still "ringing" is over now (the other person sees it as missed)
  update notifications n
     set body = case when c.kind = 'video' then 'Missed video call' else 'Missed call' end
    from calls c
   where c.caller_id = v_uid and c.status = 'ringing'
     and n.user_id = c.callee_id and n.dedupe_key = 'call:' || c.id;
  update calls set status = 'cancelled', ended_at = now()
   where caller_id = v_uid and status = 'ringing';

  insert into calls (caller_id, callee_id, kind) values (v_uid, p_callee, p_kind) returning * into v_call;

  perform radar_notify(p_callee, 'call', radar_display_name(v_uid),
                       case when p_kind = 'video' then 'Incoming video call' else 'Incoming call' end,
                       jsonb_build_object('screen', 'call', 'call_id', v_call.id, 'from_user', v_uid, 'kind', p_kind),
                       'call:' || v_call.id);
  return to_jsonb(v_call);
end;
$$;

-- 4. Accept or decline (callee only, while it's still ringing). Returns the call; status tells the outcome.
create or replace function answer_call(p_call_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_call calls;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_call from calls where id = p_call_id for update;
  if not found or v_call.callee_id <> v_uid then raise exception 'not_found'; end if;
  -- Too late (or already over): hand back the call as it is so the app can say so
  if call_ring_expired(v_call) then
    update calls set status = 'missed', ended_at = now() where id = p_call_id returning * into v_call;
    perform call_mark_missed(v_call);
    return to_jsonb(v_call);
  end if;
  if v_call.status <> 'ringing' then return to_jsonb(v_call); end if;
  if radar_is_blocked(v_call.caller_id, v_uid) then raise exception 'unavailable'; end if;

  update calls
     set status = case when p_accept then 'accepted' else 'declined' end,
         answered_at = case when p_accept then now() end,
         ended_at = case when p_accept then null else now() end
   where id = p_call_id
  returning * into v_call;

  update notifications set read_at = coalesce(read_at, now())
   where user_id = v_uid and dedupe_key = 'call:' || p_call_id;
  return to_jsonb(v_call);
end;
$$;

-- The callee's ring notification becomes a quiet "Missed call" entry in the bell
create or replace function call_mark_missed(p_call calls)
returns void language plpgsql security definer set search_path = public as $$
begin
  update notifications
     set body = case when p_call.kind = 'video' then 'Missed video call' else 'Missed call' end
   where user_id = p_call.callee_id and dedupe_key = 'call:' || p_call.id;
end;
$$;

-- 5. Hang up / cancel / give up ringing (either participant)
create or replace function end_call(p_call_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_call calls;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_call from calls where id = p_call_id for update;
  if not found or v_uid not in (v_call.caller_id, v_call.callee_id) then raise exception 'not_found'; end if;
  if v_call.status not in ('ringing', 'accepted') then return to_jsonb(v_call); end if;

  update calls
     set status = case
                    when v_call.status = 'accepted' then 'ended'
                    when v_uid = v_call.callee_id then 'declined'
                    when call_ring_expired(v_call) then 'missed'
                    else 'cancelled'
                  end,
         ended_at = now()
   where id = p_call_id
  returning * into v_call;

  if v_call.status in ('missed', 'cancelled') then perform call_mark_missed(v_call); end if;
  return to_jsonb(v_call);
end;
$$;

revoke all on function start_call(uuid, text), answer_call(uuid, boolean), end_call(uuid), call_mark_missed(calls), call_ring_expired(calls) from public, anon;
grant execute on function start_call(uuid, text), answer_call(uuid, boolean), end_call(uuid) to authenticated;

-- 6. Live updates for ringing / answered / ended
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table calls; exception when duplicate_object then null; end;
  end if;
end;
$$;
