-- NetworQ — restore objects that schema.sql defines but the live project is missing.
-- Found by the live audit on 2026-10-01:
--   * join_waitlist() does not exist  → every waitlist sign-up fails
--   * the card-images storage bucket does not exist → card photo uploads fail
--     and photos fall back to multi-MB data URLs stored in contacts.image
-- Safe to re-run.

-- ── WAITLIST ──────────────────────────────────────────────────────────────────
create sequence if not exists waitlist_position_seq;

create table if not exists waitlist (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null unique,
  created_at timestamptz default now(),
  notified   boolean     default false,
  position   int         not null          -- set explicitly by join_waitlist, never via column default
);

-- RLS on; anonymous visitors sign up only through join_waitlist()
alter table waitlist enable row level security;

-- No direct insert policy: sign-ups go through join_waitlist (security definer),
-- which validates the email and assigns the position.
drop policy if exists "Anyone can join waitlist" on waitlist;

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
set search_path = public
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
grant  execute on function join_waitlist(text) to   anon, authenticated;

-- ── CARD IMAGE STORAGE ────────────────────────────────────────────────────────
-- Public bucket: files are readable by their (unguessable) URL, which the app
-- shares in emails. Listing is NOT public — only owners can enumerate their folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload own card images" on storage.objects;
create policy "Users can upload own card images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update own card images" on storage.objects;
create policy "Users can update own card images"
  on storage.objects for update to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete own card images" on storage.objects;
create policy "Users can delete own card images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- Replaces the old "public read" select policy, which let anyone list every user's cards
drop policy if exists "Public read access for card images" on storage.objects;
drop policy if exists "Users can list own card images" on storage.objects;
create policy "Users can list own card images"
  on storage.objects for select to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);
