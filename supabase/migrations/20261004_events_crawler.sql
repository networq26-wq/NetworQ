-- NetworQBot: track where each public event came from and when it was last seen.
alter table public_events add column if not exists source text not null default 'user' check (source in ('user', 'crawler'));
alter table public_events add column if not exists last_seen_at timestamptz not null default now();
create index if not exists public_events_city_idx on public_events(city);
