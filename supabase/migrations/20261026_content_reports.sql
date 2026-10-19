-- Reports of objectionable content (Google Play: user-generated content and AI-generated content policies).
-- People report a chat message, a person, or an AI answer from inside the app; admins review them in the
-- admin panel (Safety). Additive only.

create table if not exists content_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('message', 'user', 'ai')),
  target_user  uuid references auth.users(id) on delete set null,
  message_id   uuid,
  reason       text not null check (reason in ('spam', 'harassment', 'inappropriate', 'impersonation', 'harmful', 'other')),
  details      text check (char_length(details) <= 1000),
  content      text check (char_length(content) <= 4000),  -- what was reported, as the reporter saw it
  status       text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  admin_note   text check (char_length(admin_note) <= 1000),
  handled_by   text,
  handled_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists content_reports_open on content_reports (status, created_at desc);
alter table content_reports enable row level security;
drop policy if exists "Reporters read own reports" on content_reports;
create policy "Reporters read own reports" on content_reports for select using (reporter = auth.uid());
-- writes go through report_content(); admins use the service role

create or replace function report_content(
  p_kind text, p_reason text, p_target_user uuid default null, p_message_id uuid default null,
  p_details text default null, p_content text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  new_id uuid;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if p_target_user = me then raise exception 'cannot_report_self'; end if;
  if (select count(*) from content_reports where reporter = me and created_at > now() - interval '1 day') >= 30 then
    raise exception 'rate_limited';
  end if;
  insert into content_reports (reporter, kind, target_user, message_id, reason, details, content)
  values (me, p_kind, p_target_user, p_message_id, p_reason, left(nullif(trim(p_details), ''), 1000), left(p_content, 4000))
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function report_content(text, text, uuid, uuid, text, text) from public;
grant execute on function report_content(text, text, uuid, uuid, text, text) to authenticated;
