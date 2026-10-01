-- NetworQ security hardening — run once in the Supabase SQL editor.
-- Fixes found by tests/integration/supabase-rls.test.js:
--   1. Users could UPDATE their own ai_usage rows and reset their daily AI quota.
--   2. increment_ai_usage trusted the caller-supplied p_user_id (SECURITY DEFINER).
--   3. Adds an 'email_send' daily cap so /api/email cannot be used for bulk spam.

-- 0. The live project never received this table from schema.sql — create it if missing
create table if not exists ai_usage (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  action      text not null,
  used_date   date not null default current_date,
  count       integer not null default 0,
  unique (user_id, action, used_date)
);
alter table ai_usage enable row level security;
drop policy if exists "Users can read own ai_usage" on ai_usage;
create policy "Users can read own ai_usage" on ai_usage for select using (auth.uid() = user_id);

-- 1. Usage rows are written only by increment_ai_usage (security definer)
drop policy if exists "Users can insert own ai_usage" on ai_usage;
drop policy if exists "Users can update own ai_usage" on ai_usage;

-- 3. Allow the new action
alter table ai_usage drop constraint if exists ai_usage_action_check;
alter table ai_usage add constraint ai_usage_action_check
  check (action in ('email_generation', 'card_scan', 'email_send'));

-- 2. Bind the counter to the authenticated caller
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
    v_limit := 5;
  elsif p_action = 'card_scan' then
    v_limit := 10;
  elsif p_action = 'email_send' then
    v_limit := 50;
  else
    raise exception 'Unknown action: %', p_action;
  end if;

  insert into ai_usage (user_id, action, used_date, count)
    values (p_user_id, p_action, current_date, 1)
  on conflict (user_id, action, used_date)
    do update set count = ai_usage.count + 1;

  select count into v_count
    from ai_usage
   where user_id = p_user_id
     and action  = p_action
     and used_date = current_date;

  v_allowed := v_count <= v_limit;

  if not v_allowed then
    update ai_usage
       set count = v_limit
     where user_id   = p_user_id
       and action     = p_action
       and used_date  = current_date;
  end if;

  return jsonb_build_object(
    'allowed',    v_allowed,
    'used',       least(v_count, v_limit),
    'limit',      v_limit,
    'remaining',  greatest(v_limit - least(v_count, v_limit), 0)
  );
end;
$$;

revoke execute on function increment_ai_usage(uuid, text) from public, anon;
grant  execute on function increment_ai_usage(uuid, text) to authenticated, service_role;

-- Let users clean up their own history (contact deletes already cascade)
drop policy if exists "Users can delete own emails" on follow_up_emails;
create policy "Users can delete own emails"
  on follow_up_emails for delete using (auth.uid() = user_id);
drop policy if exists "Users can delete own meetings" on meetings;
create policy "Users can delete own meetings"
  on meetings for delete using (auth.uid() = user_id);
