-- Events Hub: categories + cross-source de-duplication.
--   • category: derived from the title/description by keyword rules (one source of truth,
--     applied on every insert/update and back-filled for existing rows)
--   • dedupe_key: normalised title + start date + city. When the same event is listed on
--     two sites (e.g. Luma and AllEvents), the first one stored wins and the copy is skipped.

alter table public_events add column if not exists category text;
alter table public_events add column if not exists dedupe_key text;

create or replace function public_event_category(p_title text, p_description text)
returns text language sql immutable as $$
  select case
    when t ~ '(hackathon|hack night|buildathon|code ?jam)' then 'Hackathons'
    when t ~ '(\mai\M|artificial intelligence|machine learning|\mml\M|genai|gen ai|\mllm|data science|deep learning|agents?\M)' then 'AI & Data'
    when t ~ '(startup|founder|venture|\mvc\M|investor|pitch|fundrais|angel|incubat|accelerat|entrepreneur)' then 'Startups'
    when t ~ '(expo|summit|conference|conclave|\mcon\M|forum|congress|trade show|exhibition|fair\M)' then 'Conferences & Expos'
    when t ~ '(workshop|bootcamp|masterclass|training|course|hands-on|webinar|demo session|tutorial)' then 'Workshops'
    when t ~ '(marketing|brand|growth|seo|social media|content|advertis|sales)' then 'Marketing & Sales'
    when t ~ '(fintech|finance|crypto|blockchain|web3|banking|invest|trading|wealth)' then 'Finance & Web3'
    when t ~ '(design|\mux\M|\mui\M|product management|product manager|figma)' then 'Design & Product'
    when t ~ '(developer|devops|cloud|kubernetes|javascript|python|react|engineering|software|tech\M|coding|cyber|security)' then 'Tech'
    when t ~ '(health|medical|pharma|biotech|wellness)' then 'Health'
    when t ~ '(network|meetup|mixer|happy hour|social|community|connect|breakfast|drinks)' then 'Networking'
    else 'Business'
  end
  from (select lower(coalesce(p_title, '') || ' ' || left(coalesce(p_description, ''), 600)) as t) x;
$$;

create or replace function public_event_dedupe_key(p_title text, p_starts_at timestamptz, p_city text)
returns text language sql immutable as $$
  select left(regexp_replace(lower(coalesce(p_title, '')), '[^a-z0-9]+', '', 'g'), 80)
         || '|' || to_char(p_starts_at at time zone 'UTC', 'YYYY-MM-DD')
         || '|' || regexp_replace(lower(coalesce(p_city, '')), '[^a-z]+', '', 'g');
$$;

create or replace function public_events_prepare()
returns trigger language plpgsql set search_path = public as $$
begin
  new.category := public_event_category(new.title, new.description);
  new.dedupe_key := public_event_dedupe_key(new.title, new.starts_at, new.city);
  -- A different page for an event we already have: keep the original, skip the copy
  if tg_op = 'INSERT' and exists (select 1 from public_events p where p.dedupe_key = new.dedupe_key and p.url <> new.url) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists public_events_prepare on public_events;
create trigger public_events_prepare before insert or update of title, description, starts_at, city on public_events
  for each row execute function public_events_prepare();

-- Back-fill, then remove duplicates that already exist (keep the earliest stored)
update public_events set category = public_event_category(title, description), dedupe_key = public_event_dedupe_key(title, starts_at, city);
delete from public_events p
 using public_events q
 where p.dedupe_key = q.dedupe_key and p.ctid <> q.ctid
   and (p.created_at, p.id) > (q.created_at, q.id);

create index if not exists public_events_dedupe_idx on public_events(dedupe_key);
create index if not exists public_events_category_idx on public_events(category, starts_at);
