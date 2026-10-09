import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDb as createBase } from "./harness.mjs";

// 20261001b also sets up card-image storage, so give PGlite a minimal storage schema first
const STORAGE = `create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (bucket_id text, name text, owner uuid);
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;`;
const load = (h, m) => h.db.exec(readFileSync(new URL(`../../supabase/migrations/${m}`, import.meta.url), "utf8"));
async function createDb(...migrations) {
  const h = await createBase();
  await h.db.exec(STORAGE);
  for (const m of migrations) await load(h, m);
  return h;
}

const M = ["20261001_security_hardening.sql", "20261001b_restore_waitlist_and_storage.sql", "20261002_event_radar.sql", "20261005_connections_dedupe.sql",
           "20261003_account_email_events.sql", "20261006_realtime_notifications.sql", "20261008_nearby_radar.sql", "20261010_push_notifications.sql",
           "20261011_realtime_chat.sql", "20261012_chat_hardening.sql", "20261013_calls.sql", "20261014_release_hardening.sql", "20261019_group_calls.sql",
           "20261020_waitlist_admin.sql"];
const asService = (h) => h.db.query("select set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claim.sub', '', false)");

test("join_waitlist returns a referral code; existing rows were given one too", async () => {
  const h = await createDb(...M.slice(0, 2));
  await h.db.query("select join_waitlist('early@x.co')"); // signed up before this migration
  for (const m of M.slice(2)) await load(h, m);
  const [old] = (await h.db.query("select ref_code, status, tags from waitlist where email = 'early@x.co'")).rows;
  assert.match(old.ref_code, /^[0-9a-f]{8}$/);
  assert.equal(old.status, "waiting");
  assert.deepEqual(old.tags, []);

  const [{ r }] = (await h.db.query("select join_waitlist('New@X.co ') as r")).rows;
  assert.equal(r.already_exists, false);
  assert.match(r.ref_code, /^[0-9a-f]{8}$/);
  const [{ r: again }] = (await h.db.query("select join_waitlist('new@x.co') as r")).rows;
  assert.equal(again.already_exists, true);
  assert.equal(again.ref_code, r.ref_code);
  assert.equal(again.position, r.position);
});

test("status must be waiting / invited / joined", async () => {
  const h = await createDb(...M);
  await h.db.query("select join_waitlist('a@x.co')");
  await assert.rejects(h.db.query("update waitlist set status = 'vip' where email = 'a@x.co'"), /waitlist_status_check/);
});

test("waitlisters who created an app account are marked joined", async () => {
  const h = await createDb(...M);
  const u = await h.addUser("Asha Rao"); // asha.rao@acme.test
  await h.db.query("select join_waitlist('Asha.Rao@acme.test'), join_waitlist('other@x.co')");
  await asService(h);
  const [{ n }] = (await h.db.query("select admin_waitlist_sync_joined() as n")).rows;
  assert.equal(n, 1);
  const rows = (await h.db.query("select email, status, joined_at from waitlist order by email")).rows;
  assert.equal(rows.find((r) => r.email === "asha.rao@acme.test").status, "joined");
  assert.ok(rows.find((r) => r.email === "asha.rao@acme.test").joined_at);
  assert.equal(rows.find((r) => r.email === "other@x.co").status, "waiting");
  assert.equal((await h.db.query("select admin_waitlist_sync_joined() as n")).rows[0].n, 0); // idempotent
  assert.ok(u);
});

test("app stats count real activity", async () => {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao");
  const b = await h.addUser("Bob Iyer");
  await h.db.query("insert into contacts (user_id, name) values ($1, 'C1'), ($1, 'C2')", [a]);
  await h.db.query("insert into ai_usage (user_id, action, count) values ($1, 'card_scan', 3), ($2, 'card_scan', 2), ($2, 'email_generation', 5)", [a, b]);
  await asService(h);
  const [{ s }] = (await h.db.query("select admin_app_stats() as s")).rows;
  assert.equal(Number(s.users_total), 2);
  assert.equal(Number(s.contacts_total), 2);
  assert.equal(Number(s.contacts_7d), 2);
  assert.equal(Number(s.active_7d), 2);
  assert.deepEqual(s.ai_30d, { card_scan: 5, email_generation: 5 });
  assert.equal(s.users_new_7d, null); // the test auth.users has no created_at → reported as unavailable, not 0
});

test("signed-in users and visitors can't read the waitlist, admins or the audit log, or call admin functions", async () => {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao");
  await h.db.query("select join_waitlist('a@x.co')");
  await h.db.exec("grant usage on schema public to anon, authenticated");
  for (const role of ["anon", "authenticated"]) {
    await h.db.query(`set role ${role}`);
    if (role === "authenticated") await h.db.query("select set_config('request.jwt.claim.sub', $1, false)", [a]);
    for (const sql of ["select * from waitlist", "select * from admin_users", "select * from admin_audit", "select admin_app_stats()", "select admin_waitlist_sync_joined()"]) {
      await assert.rejects(h.db.query(sql), /permission denied/, `${role}: ${sql}`);
    }
    await h.db.query("reset role");
  }
});
