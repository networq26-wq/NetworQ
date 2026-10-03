-- Push notifications: Android app (Expo push → FCM) and browsers (Web Push / VAPID).
--   • push_tokens: one row per device/browser; a token moves to whoever signed in last on it
--   • every notification is now handed to the server hook, which pushes it (and still
--     emails only connection notices)
--   • notification_prefs gains 'push' (default on)

create table if not exists push_tokens (
  token         text primary key check (char_length(token) between 10 and 1000),
  user_id       uuid not null references auth.users(id) on delete cascade,
  platform      text not null check (platform in ('android', 'ios', 'web')),
  subscription  jsonb,                       -- Web Push subscription {endpoint, keys}
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on push_tokens(user_id);
alter table push_tokens enable row level security;
drop policy if exists "Users read own push tokens" on push_tokens;
create policy "Users read own push tokens" on push_tokens for select using (user_id = auth.uid());
-- writes only through the functions below (and the server, which removes dead tokens)

create or replace function register_push_token(p_token text, p_platform text, p_subscription jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_platform not in ('android', 'ios', 'web') then raise exception 'invalid_platform'; end if;
  if p_platform = 'web' and (p_subscription ->> 'endpoint') is distinct from p_token then raise exception 'invalid_subscription'; end if;
  insert into push_tokens (token, user_id, platform, subscription)
    values (p_token, auth.uid(), p_platform, p_subscription)
    on conflict (token) do update
      set user_id = auth.uid(), platform = excluded.platform, subscription = excluded.subscription, last_seen_at = now();
  -- keep it tidy: at most 10 devices per person
  delete from push_tokens where user_id = auth.uid() and token in (
    select token from push_tokens where user_id = auth.uid() order by last_seen_at desc offset 10);
end;
$$;

create or replace function unregister_push_token(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from push_tokens where token = p_token and user_id = auth.uid();
$$;

revoke all on function register_push_token(text, text, jsonb), unregister_push_token(text) from public, anon;
grant execute on function register_push_token(text, text, jsonb), unregister_push_token(text) to authenticated;

-- Notification preferences: add 'push'
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
           'connection_emails', coalesce((p_prefs ->> 'connection_emails')::boolean, (notification_prefs ->> 'connection_emails')::boolean, true),
           'push',              coalesce((p_prefs ->> 'push')::boolean,              (notification_prefs ->> 'push')::boolean, true))
   where id = auth.uid()
   returning notification_prefs into v;
  return v;
end;
$$;

-- Reminders become notifications too (so they reach the bell and the phone)
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('connection_request', 'connection_accepted', 'connection_declined', 'reminder', 'security', 'event', 'system'));
alter table notifications add column if not exists pushed_at timestamptz;

-- Hand every new notification to the server (push for all; email for connection notices)
drop trigger if exists notifications_dispatch on notifications;
create trigger notifications_dispatch after insert on notifications
  for each row execute function notifications_dispatch();
