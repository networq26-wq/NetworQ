-- AI prospect research + intelligent email drafting
--   • organization_profiles: what the user's own company does (used in every draft)
--   • prospect_research:     a sourced research brief per contact (facts carry source ids)
--   • follow_up_emails:      now records the outreach activity (subject, draft option,
--                            research snapshot, value used, delivery / reply status, step)
--   • contacts:              extra structured fields from cards / research
--   • ai_usage:              a 'prospect_research' daily cap; email drafts get a realistic cap

-- ── Contacts: extra structured fields ─────────────────────────────────────────
alter table contacts add column if not exists location text;
alter table contacts add column if not exists industry text;
alter table contacts add column if not exists domain text;
alter table contacts add column if not exists socials jsonb not null default '{}'::jsonb;

-- ── Our organisation (one per user) ───────────────────────────────────────────
create table if not exists organization_profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  company_name     text,
  website          text,
  description      text,
  industry         text,
  services         text[] not null default '{}',
  target_customers text,
  locations        text,
  differentiators  text,
  value_props      text,
  case_studies     text,
  socials          jsonb not null default '{}'::jsonb,
  brand_voice      text,
  preferred_tone   text,
  signature        text,
  updated_at       timestamptz not null default now()
);
alter table organization_profiles enable row level security;
drop policy if exists "Own organization profile" on organization_profiles;
create policy "Own organization profile" on organization_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on organization_profiles to authenticated;

-- ── Research briefs ───────────────────────────────────────────────────────────
create table if not exists prospect_research (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  contact_id  uuid references contacts(id) on delete cascade,
  domain      text,
  sources     jsonb not null default '[]'::jsonb,   -- [{id, kind, url, title}]
  brief       jsonb not null default '{}'::jsonb,   -- facts with status + source ids
  limitations jsonb not null default '[]'::jsonb,   -- what could not be researched, and why
  created_at  timestamptz not null default now()
);
create index if not exists prospect_research_contact_idx on prospect_research (user_id, contact_id, created_at desc);
alter table prospect_research enable row level security;
drop policy if exists "Own research read" on prospect_research;
create policy "Own research read" on prospect_research for select using (auth.uid() = user_id);
drop policy if exists "Own research delete" on prospect_research;
create policy "Own research delete" on prospect_research for delete using (auth.uid() = user_id);
drop policy if exists "Own research insert" on prospect_research;
create policy "Own research insert" on prospect_research for insert with check (
  auth.uid() = user_id
  and (contact_id is null or exists (select 1 from contacts c where c.id = contact_id and c.user_id = auth.uid()))
);
grant select, insert, delete on prospect_research to authenticated;

-- ── Outreach activity on the existing email log ───────────────────────────────
alter table follow_up_emails add column if not exists subject text;
alter table follow_up_emails add column if not exists to_email text;
alter table follow_up_emails add column if not exists draft_option text;
alter table follow_up_emails add column if not exists research_id uuid references prospect_research(id) on delete set null;
alter table follow_up_emails add column if not exists value_props text[] not null default '{}';
alter table follow_up_emails add column if not exists email_type text;
alter table follow_up_emails add column if not exists tone text;
alter table follow_up_emails add column if not exists campaign text;
alter table follow_up_emails add column if not exists provider_id text;
alter table follow_up_emails add column if not exists delivery_status text not null default 'sent';
alter table follow_up_emails add column if not exists reply_status text not null default 'none';
alter table follow_up_emails add column if not exists sequence_step integer not null default 0;
alter table follow_up_emails drop constraint if exists follow_up_emails_reply_status_check;
alter table follow_up_emails add constraint follow_up_emails_reply_status_check
  check (reply_status in ('none', 'replied', 'no_reply'));

-- Users may record their own outreach and mark replies, but only against their own contacts
alter table follow_up_emails enable row level security;
drop policy if exists "Users can insert own emails" on follow_up_emails;
drop policy if exists "Users can read own emails" on follow_up_emails;
drop policy if exists "Own outreach read" on follow_up_emails;
create policy "Own outreach read" on follow_up_emails for select using (auth.uid() = user_id);
drop policy if exists "Own outreach insert" on follow_up_emails;
create policy "Own outreach insert" on follow_up_emails for insert with check (
  auth.uid() = user_id
  and (contact_id is null or exists (select 1 from contacts c where c.id = contact_id and c.user_id = auth.uid()))
);
drop policy if exists "Own outreach update" on follow_up_emails;
create policy "Own outreach update" on follow_up_emails for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists follow_up_emails_contact_idx on follow_up_emails (user_id, contact_id, created_at desc);

-- ── Usage caps ────────────────────────────────────────────────────────────────
alter table ai_usage drop constraint if exists ai_usage_action_check;
alter table ai_usage add constraint ai_usage_action_check
  check (action in ('email_generation', 'card_scan', 'email_send', 'prospect_research'));

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

  -- One "generate" yields three drafts; regenerations and refinements each count once
  if p_action = 'email_generation' then
    v_limit := 40;
  elsif p_action = 'card_scan' then
    v_limit := 10;
  elsif p_action = 'email_send' then
    v_limit := 50;
  elsif p_action = 'prospect_research' then
    v_limit := 20;
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
