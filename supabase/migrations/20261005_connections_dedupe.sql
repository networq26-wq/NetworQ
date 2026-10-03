-- One connection per pair of people, across all events.
-- Found in preview QA: accepting a request at a second event created duplicate contacts,
-- and people already connected were offered "Connect" again.

alter table contacts add column if not exists linked_user_id uuid references auth.users(id) on delete set null;

-- Backfill links for contacts created by Radar, then remove duplicates (keep the oldest)
update contacts c set linked_user_id = u.id
  from auth.users u
 where c.reference = 'NetworQ Radar' and c.linked_user_id is null and lower(c.email) = lower(u.email);

delete from contacts c
 using contacts older
 where c.linked_user_id is not null
   and older.user_id = c.user_id and older.linked_user_id = c.linked_user_id
   and (older.added_at, older.id) < (c.added_at, c.id);

create unique index if not exists contacts_one_per_linked_user on contacts(user_id, linked_user_id) where linked_user_id is not null;

create or replace function radar_are_connected(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from connection_requests r
                  where r.status = 'accepted'
                    and ((r.from_user = p_a and r.to_user = p_b) or (r.from_user = p_b and r.to_user = p_a)));
$$;
revoke all on function radar_are_connected(uuid, uuid) from public, anon, authenticated;

create or replace function radar_contact_row(p_owner uuid, p_person uuid, p_event_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into contacts (user_id, linked_user_id, name, title, company, email, phone, linkedin, event, reference, reminder_done, email_sent, tags)
  select p_owner, p_person, coalesce(p.name, 'NetworQ attendee'), p.role, p.company, u.email, p.phone, p.linkedin,
         p_event_name, 'NetworQ Radar', false, false, array['radar']
    from auth.users u left join profiles p on p.id = u.id
   where u.id = p_person
  on conflict (user_id, linked_user_id) where linked_user_id is not null do nothing;
end;
$$;

-- Requests to someone you're already connected with resolve to "accepted" (no new pending request)
create or replace function send_connection_request(p_event_id uuid, p_to_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r connection_requests;
begin
  perform radar_require_member(p_event_id);
  if p_to_user = auth.uid() then raise exception 'cannot_connect_to_self'; end if;
  if not exists (select 1 from event_attendees where event_id = p_event_id and user_id = p_to_user) then
    raise exception 'not_a_member';
  end if;
  if radar_are_connected(auth.uid(), p_to_user) then
    return jsonb_build_object('status', 'accepted', 'to_user', p_to_user, 'already_connected', true);
  end if;
  insert into connection_requests (event_id, from_user, to_user) values (p_event_id, auth.uid(), p_to_user)
    on conflict (event_id, from_user, to_user) do update set event_id = excluded.event_id
    returning * into r;
  return to_jsonb(r);
end;
$$;

-- Outgoing statuses now include people you're connected with from any event
create or replace function my_connection_requests(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform radar_require_member(p_event_id);
  return jsonb_build_object(
    'incoming', coalesce((select jsonb_agg(radar_public_profile(r.from_user, true) || jsonb_build_object(
                    'id', r.id, 'from_user', r.from_user, 'created_at', r.created_at) order by r.created_at desc)
                  from connection_requests r
                 where r.event_id = p_event_id and r.to_user = auth.uid() and r.status = 'pending'
                   and not radar_are_connected(r.from_user, auth.uid())), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(x) from (
                    select jsonb_build_object('id', r.id, 'to_user', r.to_user, 'status', r.status) as x
                      from connection_requests r
                     where r.event_id = p_event_id and r.from_user = auth.uid()
                    union all
                    select jsonb_build_object('id', null, 'to_user', a.user_id, 'status', 'accepted')
                      from event_attendees a
                     where a.event_id = p_event_id and a.user_id <> auth.uid() and radar_are_connected(auth.uid(), a.user_id)
                  ) q), '[]'::jsonb)
  );
end;
$$;
