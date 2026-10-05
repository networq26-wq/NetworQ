-- Google-only users get one "Set a password" email (so they can also sign in with email + password).
alter table profiles add column if not exists password_setup_sent_at timestamptz;
