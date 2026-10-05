-- Hardening from the release-gate security review (runs after 20261013_calls.sql)
--   • call helper functions are internal: not callable over the API
--   • call_ring_expired is STABLE (it reads now())
--   • start_call: serialised per caller (no racing past the limit) + max 3 rings to the same person / 5 min
--   • calls table: only SELECT for signed-in users (no TRUNCATE/REFERENCES/TRIGGER grants)
--   • voice transcription gets a daily per-user cap (60)

create or replace function call_ring_expired(p_call calls)
returns boolean language sql stable as $$
  select p_call.status = 'ringing' and p_call.created_at < now() - interval '45 seconds';
$$;

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
  -- Serialise this caller's call starts so parallel requests can't slip past the limits
  perform pg_advisory_xact_lock(hashtext('start_call:' || v_uid::text));
  if (select count(*) from calls where caller_id = v_uid and created_at > now() - interval '5 minutes') >= 10 then
    raise exception 'rate_limited';
  end if;
  -- …and no more than 3 rings to the same person in 5 minutes
  if (select count(*) from calls where caller_id = v_uid and callee_id = p_callee and created_at > now() - interval '5 minutes') >= 3 then
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


revoke all on function call_mark_missed(calls), call_ring_expired(calls) from public, anon, authenticated;
revoke all on function start_call(uuid, text) from public, anon;
grant execute on function start_call(uuid, text) to authenticated;

revoke all on calls from anon, authenticated;
grant select on calls to authenticated;

-- Daily caps: add transcription
alter table ai_usage drop constraint if exists ai_usage_action_check;
alter table ai_usage add constraint ai_usage_action_check
  check (action in ('email_generation', 'card_scan', 'email_send', 'prospect_research', 'transcribe'));

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
    v_limit := 40;
  elsif p_action = 'card_scan' then
    v_limit := 10;
  elsif p_action = 'email_send' then
    v_limit := 50;
  elsif p_action = 'prospect_research' then
    v_limit := 20;
  elsif p_action = 'transcribe' then
    v_limit := 60;
  else
    raise exception 'Unknown action: %', p_action;
  end if;

  insert into ai_usage (user_id, action, used_date, count)
    values (p_user_id, p_action, current_date, 1)
  on conflict (user_id, action, used_date)
    do update set count = ai_usage.count + 1;

  select count into v_count from ai_usage
   where user_id = p_user_id and action = p_action and used_date = current_date;

  v_allowed := v_count <= v_limit;
  if not v_allowed then
    update ai_usage set count = v_limit
     where user_id = p_user_id and action = p_action and used_date = current_date;
  end if;

  return jsonb_build_object(
    'allowed',   v_allowed,
    'used',      least(v_count, v_limit),
    'limit',     v_limit,
    'remaining', greatest(v_limit - least(v_count, v_limit), 0)
  );
end;
$$;
revoke execute on function increment_ai_usage(uuid, text) from public, anon;
grant  execute on function increment_ai_usage(uuid, text) to authenticated, service_role;
