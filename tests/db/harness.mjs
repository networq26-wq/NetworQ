// Runs Supabase migrations in PGlite (real Postgres, in-process) with a minimal
// stand-in for Supabase's auth schema, so RPC rules can be tested hermetically.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const BOOTSTRAP = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table profiles (id uuid primary key references auth.users(id) on delete cascade,
    name text, company text, role text, sector text, phone text, linkedin text, bio text);
  create table contacts (id uuid primary key default gen_random_uuid(), user_id uuid not null,
    name text not null, title text, company text, email text, phone text, website text, linkedin text,
    event text, reference text, reminder text, reminder_date date, image text,
    added_at timestamptz default now(), reminder_done boolean default false,
    email_sent boolean default false, meet_link text, meet_date text, tags text[]);
`;

export async function createDb(...migrations) {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  for (const m of migrations) await db.exec(readFileSync(new URL(`../../supabase/migrations/${m}`, import.meta.url), "utf8"));
  return {
    db,
    async addUser(name, company = "Acme") {
      const id = randomUUID();
      await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${name.toLowerCase().replace(/\s/g, ".")}@acme.test`]);
      await db.query("insert into profiles (id, name, company, role, phone, linkedin) values ($1,$2,$3,'Founder','+91 90000','linkedin.com/in/x')", [id, name, company]);
      return id;
    },
    // Call an RPC as a given user (null = anonymous)
    async as(userId, sql, params = []) {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || ""]);
      const res = await db.query(sql, params);
      return res.rows;
    },
  };
}
