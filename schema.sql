-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- After running, go to Authentication → Providers and optionally disable email confirmation for dev.

-- ── PROFILES ─────────────────────────────────────────────────────────────────
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  company     text,
  role        text,
  sector      text,
  phone       text,
  linkedin    text,
  bio         text,
  created_at  timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users can read own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

-- ── CONTACTS ─────────────────────────────────────────────────────────────────
create table if not exists contacts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  name          text not null,
  title         text,
  company       text,
  email         text,
  phone         text,
  website       text,
  linkedin      text,
  event         text,
  reference     text,
  reminder      text,
  reminder_date date,
  image         text,
  added_at      timestamptz default now(),
  reminder_done boolean default false,
  email_sent    boolean default false,
  meet_link     text,
  meet_date     text
);

alter table contacts enable row level security;

create policy "Users can read own contacts"
  on contacts for select using (auth.uid() = user_id);

create policy "Users can insert own contacts"
  on contacts for insert with check (auth.uid() = user_id);

create policy "Users can update own contacts"
  on contacts for update using (auth.uid() = user_id);

create policy "Users can delete own contacts"
  on contacts for delete using (auth.uid() = user_id);

-- ── BUSINESS CARD SCANS ───────────────────────────────────────────────────────
create table if not exists business_card_scans (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete cascade not null,
  contact_id     uuid references contacts(id) on delete set null,
  image_data     text,
  extracted_data jsonb,
  created_at     timestamptz default now()
);

alter table business_card_scans enable row level security;

create policy "Users can read own scans"
  on business_card_scans for select using (auth.uid() = user_id);

create policy "Users can insert own scans"
  on business_card_scans for insert with check (auth.uid() = user_id);

-- ── FOLLOW-UP EMAILS ─────────────────────────────────────────────────────────
create table if not exists follow_up_emails (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  contact_id  uuid references contacts(id) on delete cascade not null,
  draft       text,
  sent        boolean default false,
  sent_at     timestamptz,
  created_at  timestamptz default now()
);

alter table follow_up_emails enable row level security;

create policy "Users can read own emails"
  on follow_up_emails for select using (auth.uid() = user_id);

create policy "Users can insert own emails"
  on follow_up_emails for insert with check (auth.uid() = user_id);

-- ── MEETINGS ─────────────────────────────────────────────────────────────────
create table if not exists meetings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  contact_id  uuid references contacts(id) on delete cascade not null,
  meet_link   text,
  meet_date   text,
  meet_time   text,
  notes       text,
  created_at  timestamptz default now()
);

alter table meetings enable row level security;

create policy "Users can read own meetings"
  on meetings for select using (auth.uid() = user_id);

create policy "Users can insert own meetings"
  on meetings for insert with check (auth.uid() = user_id);

-- ── AI USAGE ──────────────────────────────────────────────────────────────────
-- Tracks per-user daily usage for email_generation and card_scan actions.
-- Limits: 5 email generations / day, 10 card scans / day.
create table if not exists ai_usage (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  action      text not null check (action in ('email_generation', 'card_scan')),
  used_date   date not null default current_date,
  count       integer not null default 0,
  unique (user_id, action, used_date)
);

alter table ai_usage enable row level security;

create policy "Users can read own ai_usage"
  on ai_usage for select using (auth.uid() = user_id);

create policy "Users can insert own ai_usage"
  on ai_usage for insert with check (auth.uid() = user_id);

create policy "Users can update own ai_usage"
  on ai_usage for update using (auth.uid() = user_id);

-- ── WAITLIST ──────────────────────────────────────────────────────────────────
create sequence if not exists waitlist_position_seq;

create table if not exists waitlist (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null unique,
  created_at timestamptz default now(),
  notified   boolean     default false,
  position   int         not null          -- set explicitly by join_waitlist, never via column default
);

-- Public insert only — no auth required for sign-ups
alter table waitlist enable row level security;

create policy "Anyone can join waitlist"
  on waitlist for insert with check (true);

-- Returns {already_exists: boolean, position: int, show_position: boolean}
-- show_position is false until the waitlist has at least 20 signups.
--
-- Sequence safety: nextval() is only called when we are certain the email is
-- new, so duplicate submissions never advance the sequence or burn a number.
-- Race condition (two concurrent new signups for the same email): the inner
-- BEGIN/EXCEPTION block catches the unique_violation that would otherwise
-- surface as an error, re-fetches the winner's row, and returns already_exists:
-- true. One sequence number is burned in that rare case — accepted tradeoff.
create or replace function join_waitlist(p_email text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_email    text := lower(trim(p_email));
  v_position int;
  v_count    int;
begin
  -- Server-side email format guard (can't be bypassed via direct RPC)
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using hint = 'Please enter a valid email address.';
  end if;

  -- Check existence first — never touch the sequence for a duplicate
  select position into v_position
    from waitlist
   where email = v_email;

  if found then
    select count(*) into v_count from waitlist;
    return jsonb_build_object(
      'already_exists', true,
      'position',       v_position,
      'show_position',  v_count >= 20
    );
  end if;

  -- New email: claim the next position then insert
  begin
    v_position := nextval('waitlist_position_seq');
    insert into waitlist (email, position)
      values (v_email, v_position);
  exception when unique_violation then
    -- Another session won the race and inserted this email between our
    -- SELECT and INSERT. Fetch their row and return as an existing signup.
    select position into v_position
      from waitlist
     where email = v_email;

    select count(*) into v_count from waitlist;
    return jsonb_build_object(
      'already_exists', true,
      'position',       v_position,
      'show_position',  v_count >= 20
    );
  end;

  select count(*) into v_count from waitlist;
  return jsonb_build_object(
    'already_exists', false,
    'position',       v_position,
    'show_position',  v_count >= 20
  );
end;
$$;

revoke execute on function join_waitlist(text) from public;
grant  execute on function join_waitlist(text) to   anon;

-- Returns {allowed: boolean, remaining: integer}
-- Increments the counter atomically; returns false if the daily limit is exceeded.
create or replace function increment_ai_usage(p_user_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_limit    integer;
  v_count    integer;
  v_allowed  boolean;
begin
  -- Determine per-action daily limit
  if p_action = 'email_generation' then
    v_limit := 5;
  elsif p_action = 'card_scan' then
    v_limit := 10;
  else
    raise exception 'Unknown action: %', p_action;
  end if;

  -- Upsert today's row and increment atomically
  insert into ai_usage (user_id, action, used_date, count)
    values (p_user_id, p_action, current_date, 1)
  on conflict (user_id, action, used_date)
    do update set count = ai_usage.count + 1;

  -- Read back the count just written
  select count into v_count
    from ai_usage
   where user_id = p_user_id
     and action  = p_action
     and used_date = current_date;

  v_allowed := v_count <= v_limit;

  -- If over the limit, roll back the increment so the count stays at the cap
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
