-- NetworQ Realtime In-App Messaging & Event Chat
-- Direct 1:1 messaging between connected peers, event room chat, read receipts, and typing indicators.

create table if not exists direct_chats (
  id               uuid primary key default gen_random_uuid(),
  user1_id         uuid not null references auth.users(id) on delete cascade,
  user2_id         uuid not null references auth.users(id) on delete cascade,
  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  constraint direct_chats_users_unique unique (user1_id, user2_id),
  constraint direct_chats_diff_users check (user1_id <> user2_id)
);

create index if not exists direct_chats_user1_idx on direct_chats(user1_id);
create index if not exists direct_chats_user2_idx on direct_chats(user2_id);
create index if not exists direct_chats_last_msg_idx on direct_chats(last_message_at desc);

create table if not exists chat_messages (
  id            uuid primary key default gen_random_uuid(),
  chat_id       uuid references direct_chats(id) on delete cascade,
  event_id      uuid references events(id) on delete cascade,
  sender_id     uuid not null references auth.users(id) on delete cascade,
  recipient_id  uuid references auth.users(id) on delete cascade,
  content       text not null check (char_length(trim(content)) > 0 and char_length(content) <= 4000),
  media_url     text,
  status        text not null default 'sent' check (status in ('sent', 'delivered', 'read')),
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists chat_messages_chat_idx on chat_messages(chat_id, created_at asc);
create index if not exists chat_messages_event_idx on chat_messages(event_id, created_at asc);
create index if not exists chat_messages_recipient_unread_idx on chat_messages(recipient_id, status) where status != 'read';

-- Enable RLS
alter table direct_chats enable row level security;
alter table chat_messages enable row level security;

-- Policies for direct_chats
drop policy if exists "Users can access their direct chats" on direct_chats;
create policy "Users can access their direct chats" on direct_chats
  for select using (auth.uid() = user1_id or auth.uid() = user2_id);

-- Policies for chat_messages
drop policy if exists "Users can view direct messages in their chats" on chat_messages;
create policy "Users can view direct messages in their chats" on chat_messages
  for select using (
    auth.uid() = sender_id
    or auth.uid() = recipient_id
    or (
      event_id is not null
      and exists (
        select 1 from event_attendees ea
        where ea.event_id = chat_messages.event_id
        and ea.user_id = auth.uid()
      )
    )
  );

drop policy if exists "Users can insert messages" on chat_messages;
create policy "Users can insert messages" on chat_messages
  for insert with check (
    auth.uid() = sender_id
  );

-- RPC: Get or create direct chat
create or replace function get_or_create_direct_chat(p_other_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_u1 uuid;
  v_u2 uuid;
  v_chat_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if v_uid = p_other_user_id then
    raise exception 'Cannot chat with yourself';
  end if;

  if v_uid < p_other_user_id then
    v_u1 := v_uid;
    v_u2 := p_other_user_id;
  else
    v_u1 := p_other_user_id;
    v_u2 := v_uid;
  end if;

  select id into v_chat_id from direct_chats where user1_id = v_u1 and user2_id = v_u2;

  if v_chat_id is null then
    insert into direct_chats (user1_id, user2_id, last_message_at)
    values (v_u1, v_u2, now())
    returning id into v_chat_id;
  end if;

  return v_chat_id;
end;
$$;

-- RPC: Send chat message
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
  v_msg_id uuid;
  v_created_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_recipient_id is not null then
    v_chat_id := get_or_create_direct_chat(p_recipient_id);
    update direct_chats set last_message_at = now() where id = v_chat_id;
  elsif p_event_id is not null then
    -- Verify user is attendee
    if not exists (select 1 from event_attendees where event_id = p_event_id and user_id = v_uid) then
      raise exception 'Must be an attendee to chat in this event room';
    end if;
  else
    raise exception 'Recipient or Event ID is required';
  end if;

  insert into chat_messages (chat_id, event_id, sender_id, recipient_id, content, media_url, status)
  values (v_chat_id, p_event_id, v_uid, p_recipient_id, trim(p_content), p_media_url, 'sent')
  returning id, created_at into v_msg_id, v_created_at;

  return jsonb_build_object(
    'id', v_msg_id,
    'chat_id', v_chat_id,
    'event_id', p_event_id,
    'sender_id', v_uid,
    'recipient_id', p_recipient_id,
    'content', trim(p_content),
    'media_url', p_media_url,
    'status', 'sent',
    'created_at', v_created_at
  );
end;
$$;

-- RPC: Mark messages read
create or replace function mark_chat_read(p_chat_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update chat_messages
  set status = 'read', read_at = now()
  where chat_id = p_chat_id
    and recipient_id = auth.uid()
    and status != 'read';
end;
$$;

-- Enable Realtime
do $$
begin
  alter publication supabase_realtime add table chat_messages;
exception when others then
  -- Ignore if already added
end;
$$;
