-- Radar without an event: one built-in "Nearby" space.
-- Joining it reuses everything the event radar has (rotating BLE tokens, see-to-be-seen,
-- requests, blocking, notifications). The one hard rule: nobody can LIST the people in
-- Nearby — you only ever learn about someone whose rotating token your phone detected
-- over Bluetooth, so presence is proved by physical proximity, never by a global directory.

alter table events drop constraint if exists events_source_check;
alter table events add constraint events_source_check check (source in ('listed', 'user', 'nearby'));

insert into events (external_id, name, source)
values ('networq:nearby', 'Nearby', 'nearby')
on conflict (external_id) do nothing;

create or replace function radar_nearby_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from events where external_id = 'networq:nearby';
$$;

-- Join Nearby (or update the discoverable switch). Discoverable is off unless asked for.
create or replace function join_nearby(p_discoverable boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event events;
  v event_attendees;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_event from events where external_id = 'networq:nearby';
  insert into event_attendees (event_id, user_id, radar_on, visible)
    values (v_event.id, auth.uid(), true, p_discoverable)
    on conflict (event_id, user_id) do update set radar_on = true, visible = p_discoverable, last_seen_at = now()
    returning * into v;
  if not p_discoverable then
    delete from radar_tokens where event_id = v_event.id and user_id = auth.uid();
  end if;
  return radar_event_json(v_event) || jsonb_build_object(
    'settings', jsonb_build_object('radar_on', v.radar_on, 'visible', v.visible,
                                   'show_distance', v.show_distance, 'show_profile', v.show_profile));
end;
$$;

-- Am I in Nearby? (null when not) — read-only, never changes settings
create or replace function nearby_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select radar_event_json(e) || jsonb_build_object(
           'settings', jsonb_build_object('radar_on', a.radar_on, 'visible', a.visible,
                                          'show_distance', a.show_distance, 'show_profile', a.show_profile))
    from events e join event_attendees a on a.event_id = e.id and a.user_id = auth.uid()
   where e.external_id = 'networq:nearby';
$$;

-- Turning Nearby off removes you completely (tokens included)
create or replace function leave_nearby()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from radar_tokens where event_id = radar_nearby_id() and user_id = auth.uid();
  delete from event_attendees where event_id = radar_nearby_id() and user_id = auth.uid();
end;
$$;

-- Nearby can't be joined through the listed-events path
create or replace function join_listed_event(p_external_id text, p_name text,
                                             p_venue text default null, p_starts_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_event events;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_external_id like 'networq:%' then raise exception 'invalid_event'; end if;
  insert into events (external_id, name, venue, starts_at, source, created_by)
    values (p_external_id, trim(p_name), p_venue, p_starts_at, 'listed', auth.uid())
    on conflict (external_id) do update set external_id = excluded.external_id
    returning * into v_event;
  if v_event.source = 'nearby' then raise exception 'invalid_event'; end if;
  insert into event_attendees (event_id, user_id) values (v_event.id, auth.uid())
    on conflict (event_id, user_id) do update set last_seen_at = now();
  return radar_event_json(v_event);
end;
$$;

-- Nearby is not an event: keep it out of "my events" (and never expose its member count)
create or replace function my_events()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(radar_event_json(e) || jsonb_build_object(
           'attendee_count', (select count(*) from event_attendees x where x.event_id = e.id),
           'settings', jsonb_build_object('radar_on', a.radar_on, 'visible', a.visible,
                                          'show_distance', a.show_distance, 'show_profile', a.show_profile))
         order by a.joined_at desc), '[]'::jsonb)
  from event_attendees a join events e on e.id = a.event_id
  where a.user_id = auth.uid() and e.source <> 'nearby';
$$;

-- No attendee list for Nearby — Bluetooth detection is the only way to find someone
create or replace function list_event_attendees(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v event_attendees;
  v_people jsonb;
begin
  v := radar_require_member(p_event_id);
  update event_attendees set last_seen_at = now() where event_id = p_event_id and user_id = auth.uid();
  if p_event_id = radar_nearby_id() then
    return jsonb_build_object('people', '[]'::jsonb, 'hidden_count', 0);
  end if;
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

revoke execute on function join_nearby(boolean), leave_nearby(), radar_nearby_id(), nearby_status() from public, anon;
grant execute on function join_nearby(boolean), leave_nearby(), radar_nearby_id(), nearby_status() to authenticated;
