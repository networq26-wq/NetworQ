-- Follow-up autopilot (runs after 20261020_waitlist_admin.sql)
--   • per user: on/off (off until the user turns it on — we email their contacts on their behalf),
--     schedule (days after meeting, default 1 / 7 / 30) and an optional signature
--   • per contact: where it is in the sequence, when the next email is due, and why it stopped
--     (paused by the user, they replied, finished, or the contact unsubscribed)
--   • followup_log: every email the autopilot sent (or failed to send) — users see their own
--   • followup_optouts: recipients who unsubscribed from autopilot emails (never emailed again)
-- Sending happens on the server (service role); users can only read their own data and change
-- their own settings / contacts.

-- 1. User settings
alter table profiles add column if not exists autopilot_enabled boolean not null default false;
alter table profiles add column if not exists autopilot_days integer[] not null default '{1,7,30}';
alter table profiles add column if not exists autopilot_signature text;
alter table profiles add column if not exists autopilot_enabled_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_autopilot_days_check') then
    alter table profiles add constraint profiles_autopilot_days_check
      check (cardinality(autopilot_days) between 1 and 5 and 0 < all (autopilot_days) and 365 >= all (autopilot_days));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_autopilot_signature_len') then
    alter table profiles add constraint profiles_autopilot_signature_len check (autopilot_signature is null or char_length(autopilot_signature) <= 500);
  end if;
end;
$$;

-- 2. Per-contact sequence state
alter table contacts add column if not exists autopilot_status text not null default 'active';
alter table contacts add column if not exists autopilot_step integer not null default 0;      -- emails already sent
alter table contacts add column if not exists autopilot_next_at timestamptz;
alter table contacts add column if not exists autopilot_last_sent_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_autopilot_status_check') then
    alter table contacts add constraint contacts_autopilot_status_check
      check (autopilot_status in ('active', 'paused', 'replied', 'done', 'opted_out'));
  end if;
end;
$$;
create index if not exists contacts_autopilot_due_idx on contacts (autopilot_next_at) where autopilot_status = 'active';

-- First email is due 1 day (the user's first step) after the contact is added
create or replace function contacts_autopilot_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_first integer;
begin
  if new.autopilot_next_at is null and new.autopilot_step = 0 then
    select coalesce(autopilot_days[1], 1) into v_first from profiles where id = new.user_id;
    new.autopilot_next_at := coalesce(new.added_at, now()) + make_interval(days => coalesce(v_first, 1));
  end if;
  return new;
end;
$$;
drop trigger if exists contacts_autopilot_schedule on contacts;
create trigger contacts_autopilot_schedule before insert on contacts for each row execute function contacts_autopilot_schedule();

-- Existing contacts: schedule from now (never back-fill a burst of old follow-ups)
update contacts set autopilot_next_at = now() + interval '1 day' where autopilot_next_at is null and autopilot_step = 0;

-- 3. Log
create table if not exists followup_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid references contacts (id) on delete set null,
  step integer not null,
  to_email text not null,
  subject text,
  body text,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists followup_log_user_idx on followup_log (user_id, created_at desc);
alter table followup_log enable row level security;
drop policy if exists "Users read their own follow-up log" on followup_log;
create policy "Users read their own follow-up log" on followup_log for select using (user_id = auth.uid());
revoke all on followup_log from anon, authenticated;
grant select on followup_log to authenticated;

-- 4. Recipients who unsubscribed (server only)
create table if not exists followup_optouts (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table followup_optouts enable row level security;
revoke all on followup_optouts from anon, authenticated;

-- 5. User controls (only their own rows)
create or replace function set_autopilot(p_enabled boolean, p_days integer[] default null, p_signature text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v profiles;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update profiles
     set autopilot_enabled = p_enabled,
         autopilot_enabled_at = case when p_enabled and not autopilot_enabled then now() else autopilot_enabled_at end,
         autopilot_days = coalesce(p_days, autopilot_days),
         autopilot_signature = case when p_signature is null then autopilot_signature else nullif(trim(p_signature), '') end
   where id = v_uid
   returning * into v;
  -- Turning it on: nothing old is sent in a burst — anything overdue starts tomorrow
  if p_enabled then
    update contacts set autopilot_next_at = greatest(autopilot_next_at, now() + interval '1 day')
     where user_id = v_uid and autopilot_status = 'active' and autopilot_next_at < now();
  end if;
  return jsonb_build_object('enabled', v.autopilot_enabled, 'days', v.autopilot_days, 'signature', v.autopilot_signature);
end;
$$;

create or replace function set_contact_autopilot(p_contact uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); c contacts;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_status not in ('active', 'paused', 'replied') then raise exception 'invalid_status'; end if;
  update contacts
     set autopilot_status = case when autopilot_status = 'opted_out' then 'opted_out' else p_status end,
         autopilot_next_at = case when p_status = 'active' and autopilot_status <> 'opted_out'
                                  then greatest(coalesce(autopilot_next_at, now()), now() + interval '1 hour') else autopilot_next_at end
   where id = p_contact and user_id = v_uid
   returning * into c;
  if c.id is null then raise exception 'not_found'; end if;
  return jsonb_build_object('status', c.autopilot_status, 'step', c.autopilot_step, 'next_at', c.autopilot_next_at);
end;
$$;

revoke all on function set_autopilot(boolean, integer[], text), set_contact_autopilot(uuid, text), contacts_autopilot_schedule() from public, anon;
grant execute on function set_autopilot(boolean, integer[], text), set_contact_autopilot(uuid, text) to authenticated;
