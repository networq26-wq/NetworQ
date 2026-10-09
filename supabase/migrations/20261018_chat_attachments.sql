-- Photos & files in 1:1 chats (runs after 20261012_chat_hardening.sql)
--   • private bucket `chat-files`: objects live under <chat_id>/…; only the two people in that chat
--     (connected, not blocked) can upload or read; 10 MB; images, PDF, Office docs, text, zip
--   • messages can carry one attachment; a message may be just the attachment (no text)
--   • send_chat_message checks the file is in THIS chat's folder and was uploaded by the sender

-- 1. Attachment columns
alter table chat_messages add column if not exists attachment_path text;
alter table chat_messages add column if not exists attachment_name text;
alter table chat_messages add column if not exists attachment_type text;
alter table chat_messages add column if not exists attachment_size integer;

-- Text OR an attachment (was: text required)
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'chat_messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%content%' loop
    execute format('alter table chat_messages drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table chat_messages add constraint chat_messages_content_or_attachment
  check ((char_length(trim(content)) > 0 or attachment_path is not null) and char_length(content) <= 4000);

-- 2. Private bucket
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('chat-files', 'chat-files', false, 10485760, array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
    'application/pdf', 'text/plain', 'text/csv', 'application/zip',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
end;
$$;

-- Is the signed-in user a member of the chat whose id is the object's first folder (and not blocked)?
create or replace function chat_file_allowed(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_chat uuid;
begin
  if auth.uid() is null then return false; end if;
  begin
    v_chat := split_part(p_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return exists (select 1 from direct_chats c
                  where c.id = v_chat
                    and auth.uid() in (c.user1_id, c.user2_id)
                    and not radar_is_blocked(c.user1_id, c.user2_id));
end;
$$;
revoke all on function chat_file_allowed(text) from public, anon;
grant execute on function chat_file_allowed(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  execute 'drop policy if exists "chat files upload" on storage.objects';
  execute 'drop policy if exists "chat files read" on storage.objects';
  execute $p$create policy "chat files upload" on storage.objects for insert to authenticated
    with check (bucket_id = 'chat-files' and public.chat_file_allowed(name))$p$;
  execute $p$create policy "chat files read" on storage.objects for select to authenticated
    using (bucket_id = 'chat-files' and public.chat_file_allowed(name))$p$;
end;
$$;

-- 3. Sending: optional attachment (1:1 chats only)
drop function if exists send_chat_message(uuid, uuid, text, text);
create or replace function send_chat_message(
  p_recipient_id uuid default null,
  p_event_id uuid default null,
  p_content text default '',
  p_media_url text default null,
  p_attachment_path text default null,
  p_attachment_name text default null,
  p_attachment_type text default null,
  p_attachment_size integer default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_chat_id uuid := null;
  v_msg chat_messages;
  v_text text := trim(coalesce(p_content, ''));
  v_has_file boolean := p_attachment_path is not null;
  v_file_ok boolean := false;
  v_preview text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_text = '' and not v_has_file then raise exception 'empty_message'; end if;
  if char_length(v_text) > 4000 then raise exception 'message_too_long'; end if;
  if p_media_url is not null and p_media_url !~ '^https://' then raise exception 'invalid_media'; end if;
  if (select count(*) from chat_messages where sender_id = v_uid and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'rate_limited';
  end if;

  if p_recipient_id is not null then
    v_chat_id := get_or_create_direct_chat(p_recipient_id);   -- enforces connected + not blocked
  elsif p_event_id is not null then
    if v_has_file then raise exception 'attachments_direct_only'; end if;
    if p_event_id = radar_nearby_id() then raise exception 'invalid_event'; end if;
    if not exists (select 1 from event_attendees where event_id = p_event_id and user_id = v_uid) then
      raise exception 'not_a_member';
    end if;
  else
    raise exception 'recipient_required';
  end if;

  if v_has_file then
    -- must be in this chat's folder, uploaded by the sender, and really there
    if split_part(p_attachment_path, '/', 1) <> v_chat_id::text or p_attachment_path like '%..%' then raise exception 'invalid_attachment'; end if;
    if to_regclass('storage.objects') is not null then
      execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2 and owner = $3)'
        into v_file_ok using 'chat-files', p_attachment_path, v_uid;
      if not v_file_ok then raise exception 'invalid_attachment'; end if;
    end if;
    if p_attachment_size is not null and (p_attachment_size < 0 or p_attachment_size > 10485760) then raise exception 'attachment_too_large'; end if;
  end if;

  if v_chat_id is not null then update direct_chats set last_message_at = now() where id = v_chat_id; end if;

  insert into chat_messages (chat_id, event_id, sender_id, recipient_id, content, media_url, status,
                             attachment_path, attachment_name, attachment_type, attachment_size)
  values (v_chat_id, case when p_recipient_id is null then p_event_id end, v_uid, p_recipient_id, v_text, p_media_url, 'sent',
          p_attachment_path, left(p_attachment_name, 200), left(p_attachment_type, 120), p_attachment_size)
  returning * into v_msg;

  v_preview := case
    when v_text <> '' then left(v_text, 140)
    when coalesce(p_attachment_type, '') like 'image/%' then '📷 Photo'
    else '📎 ' || coalesce(left(p_attachment_name, 120), 'File')
  end;

  -- One live notification per conversation (as before)
  if p_recipient_id is not null then
    if exists (select 1 from notifications where user_id = p_recipient_id and dedupe_key = 'chat:' || v_chat_id and read_at is null) then
      update notifications set body = v_preview, created_at = now()
       where user_id = p_recipient_id and dedupe_key = 'chat:' || v_chat_id;
    else
      delete from notifications where user_id = p_recipient_id and dedupe_key = 'chat:' || v_chat_id;
      perform radar_notify(p_recipient_id, 'message', radar_display_name(v_uid), v_preview,
                           jsonb_build_object('screen', 'chat', 'chat_id', v_chat_id, 'from_user', v_uid), 'chat:' || v_chat_id);
    end if;
  end if;

  return to_jsonb(v_msg);
end;
$$;
revoke all on function send_chat_message(uuid, uuid, text, text, text, text, text, integer) from public, anon;
grant execute on function send_chat_message(uuid, uuid, text, text, text, text, text, integer) to authenticated;

-- Conversation list shows "📷 Photo" / "📎 file" for attachment-only messages
create or replace function chat_message_preview(m chat_messages)
returns text language sql immutable as $$
  select case when trim(m.content) <> '' then m.content
              when coalesce(m.attachment_type, '') like 'image/%' then '📷 Photo'
              when m.attachment_path is not null then '📎 ' || coalesce(m.attachment_name, 'File')
              else m.content end;
$$;

create or replace function my_direct_chats()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'chat_id', c.id,
           'other_user', o.uid,
           'name', radar_display_name(o.uid),
           'avatar', (select avatar_url from profiles p where p.id = o.uid),
           'last_message_at', c.last_message_at,
           'last_message', (select left(chat_message_preview(m), 140) from chat_messages m where m.chat_id = c.id order by m.created_at desc limit 1),
           'unread', (select count(*) from chat_messages m where m.chat_id = c.id and m.recipient_id = auth.uid() and m.status <> 'read')
         ) order by c.last_message_at desc), '[]'::jsonb)
    from direct_chats c
    cross join lateral (select case when c.user1_id = auth.uid() then c.user2_id else c.user1_id end as uid) o
   where (c.user1_id = auth.uid() or c.user2_id = auth.uid())
     and not radar_is_blocked(c.user1_id, c.user2_id);
$$;
revoke all on function my_direct_chats() from public, anon;
grant execute on function my_direct_chats() to authenticated;
