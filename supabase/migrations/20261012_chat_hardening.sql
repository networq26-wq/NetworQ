-- Chat hardening (runs after 20261011_realtime_chat.sql)
--   • messages are written ONLY through send_chat_message (no direct inserts / updates)
--   • 1:1 messages only between connected people, never across a block
--   • event rooms only for real events you've joined — never the private "Nearby" space
--   • a per-sender rate limit (30 messages / minute)
--   • a new 1:1 message creates (or refreshes) one notification per conversation, so it
--     reaches the bell and — via the notifications hook — the phone as a push
--   • realtime private channels: typing indicators and call signalling are visible only to
--     the two people in the conversation (Realtime Authorization on realtime.messages)

-- 1. No direct writes
drop policy if exists "Users can insert messages" on chat_messages;
revoke insert, update, delete on chat_messages from anon, authenticated;
revoke insert, update, delete on direct_chats from anon, authenticated;

-- 2. Notifications can be about messages
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('connection_request', 'connection_accepted', 'connection_declined', 'reminder', 'message', 'security', 'event', 'system'));

-- 3. Only connected, unblocked people can open a 1:1 chat
create or replace function get_or_create_direct_chat(p_other_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_u1 uuid;
  v_u2 uuid;
  v_chat_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_other_user_id is null or v_uid = p_other_user_id then raise exception 'invalid_recipient'; end if;
  if radar_is_blocked(v_uid, p_other_user_id) then raise exception 'unavailable'; end if;
  if not radar_are_connected(v_uid, p_other_user_id) then raise exception 'not_connected'; end if;

  if v_uid < p_other_user_id then v_u1 := v_uid; v_u2 := p_other_user_id;
  else v_u1 := p_other_user_id; v_u2 := v_uid; end if;

  select id into v_chat_id from direct_chats where user1_id = v_u1 and user2_id = v_u2;
  if v_chat_id is null then
    insert into direct_chats (user1_id, user2_id, last_message_at) values (v_u1, v_u2, now())
    on conflict (user1_id, user2_id) do update set last_message_at = direct_chats.last_message_at
    returning id into v_chat_id;
  end if;
  return v_chat_id;
end;
$$;

-- 4. The one way to send
create or replace function send_chat_message(
  p_recipient_id uuid default null,
  p_event_id uuid default null,
  p_content text default '',
  p_media_url text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_chat_id uuid := null;
  v_msg chat_messages;
  v_text text := trim(coalesce(p_content, ''));
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_text = '' then raise exception 'empty_message'; end if;
  if char_length(v_text) > 4000 then raise exception 'message_too_long'; end if;
  if p_media_url is not null and p_media_url !~ '^https://' then raise exception 'invalid_media'; end if;
  if (select count(*) from chat_messages where sender_id = v_uid and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'rate_limited';
  end if;

  if p_recipient_id is not null then
    v_chat_id := get_or_create_direct_chat(p_recipient_id);   -- enforces connected + not blocked
    update direct_chats set last_message_at = now() where id = v_chat_id;
  elsif p_event_id is not null then
    if p_event_id = radar_nearby_id() then raise exception 'invalid_event'; end if;
    if not exists (select 1 from event_attendees where event_id = p_event_id and user_id = v_uid) then
      raise exception 'not_a_member';
    end if;
  else
    raise exception 'recipient_required';
  end if;

  insert into chat_messages (chat_id, event_id, sender_id, recipient_id, content, media_url, status)
  values (v_chat_id, case when p_recipient_id is null then p_event_id end, v_uid, p_recipient_id, v_text, p_media_url, 'sent')
  returning * into v_msg;

  -- One live notification per conversation: inserted (→ push) when none is unread, otherwise refreshed quietly
  if p_recipient_id is not null then
    if exists (select 1 from notifications where user_id = p_recipient_id and dedupe_key = 'chat:' || v_chat_id and read_at is null) then
      update notifications
         set body = left(v_text, 140), created_at = now()
       where user_id = p_recipient_id and dedupe_key = 'chat:' || v_chat_id;
    else
      delete from notifications where user_id = p_recipient_id and dedupe_key = 'chat:' || v_chat_id;
      perform radar_notify(p_recipient_id, 'message', radar_display_name(v_uid), left(v_text, 140),
                           jsonb_build_object('screen', 'chat', 'chat_id', v_chat_id, 'from_user', v_uid), 'chat:' || v_chat_id);
    end if;
  end if;

  return to_jsonb(v_msg);
end;
$$;

-- 5. Read receipts (recipient only)
create or replace function mark_chat_read(p_chat_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update chat_messages set status = 'read', read_at = now()
   where chat_id = p_chat_id and recipient_id = auth.uid() and status <> 'read';
  update notifications set read_at = now()
   where user_id = auth.uid() and dedupe_key = 'chat:' || p_chat_id and read_at is null;
end;
$$;

-- Wrappers callable from RLS by signed-in users: they only ever answer about auth.uid()
create or replace function chat_sender_blocked(p_sender uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select radar_is_blocked(auth.uid(), p_sender);
$$;

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
  end if;
  return false;
end;
$$;
revoke all on function chat_sender_blocked(uuid), realtime_topic_allowed(text) from public, anon;
grant execute on function chat_sender_blocked(uuid), realtime_topic_allowed(text) to authenticated;

-- 6. Event-room reads: never the Nearby space; blocked senders hidden from each other
drop policy if exists "Users can view direct messages in their chats" on chat_messages;
create policy "Users can view direct messages in their chats" on chat_messages
  for select using (
    auth.uid() = sender_id
    or auth.uid() = recipient_id
    or (
      event_id is not null
      and event_id <> radar_nearby_id()
      and exists (select 1 from event_attendees ea where ea.event_id = chat_messages.event_id and ea.user_id = auth.uid())
      and not chat_sender_blocked(sender_id)
    )
  );

-- 7. Conversation list helper (names for the other person; no other profile access needed)
create or replace function my_direct_chats()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'chat_id', c.id,
           'other_user', o.uid,
           'name', radar_display_name(o.uid),
           'avatar', (select avatar_url from profiles p where p.id = o.uid),
           'last_message_at', c.last_message_at,
           'last_message', (select left(m.content, 140) from chat_messages m where m.chat_id = c.id order by m.created_at desc limit 1),
           'unread', (select count(*) from chat_messages m where m.chat_id = c.id and m.recipient_id = auth.uid() and m.status <> 'read')
         ) order by c.last_message_at desc), '[]'::jsonb)
    from direct_chats c
    cross join lateral (select case when c.user1_id = auth.uid() then c.user2_id else c.user1_id end as uid) o
   where (c.user1_id = auth.uid() or c.user2_id = auth.uid())
     and not radar_is_blocked(c.user1_id, c.user2_id);
$$;

revoke all on function get_or_create_direct_chat(uuid), send_chat_message(uuid, uuid, text, text), mark_chat_read(uuid), my_direct_chats() from public, anon;
grant execute on function get_or_create_direct_chat(uuid), send_chat_message(uuid, uuid, text, text), mark_chat_read(uuid), my_direct_chats() to authenticated;

-- 8. Realtime Authorization for private channels:
--    chat:<chat_id>        → the two members of that chat (typing indicators)
--    call:<user1>_<user2>  → those two users, only while connected and not blocked (WebRTC signalling)
do $$
begin
  if to_regclass('realtime.messages') is null then return; end if;
  execute 'drop policy if exists "networq private channels read" on realtime.messages';
  execute 'drop policy if exists "networq private channels write" on realtime.messages';
  execute 'create policy "networq private channels read" on realtime.messages for select to authenticated using (public.realtime_topic_allowed(realtime.topic()))';
  execute 'create policy "networq private channels write" on realtime.messages for insert to authenticated with check (public.realtime_topic_allowed(realtime.topic()))';
end;
$$;
