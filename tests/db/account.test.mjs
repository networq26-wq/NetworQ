import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const setup = async () => {
  const h = await createDb("20261003_account_email_events.sql");
  const a = await h.addUser("Asha Rao");
  const b = await h.addUser("Bob Iyer");
  return { h, a, b };
};

test("profiles get default notification prefs", async () => {
  const { h, a } = await setup();
  const [row] = (await h.db.query("select notification_prefs from profiles where id = $1", [a])).rows;
  assert.deepEqual(row.notification_prefs, { login_alerts: true, reminder_emails: true, product_updates: false });
});

test("update_notification_prefs merges known keys only, for the caller only", async () => {
  const { h, a, b } = await setup();
  const [{ r }] = await h.as(a, `select update_notification_prefs('{"login_alerts": false, "evil": true}'::jsonb) as r`);
  assert.deepEqual(r, { login_alerts: false, reminder_emails: true, product_updates: false });
  const [other] = (await h.db.query("select notification_prefs from profiles where id = $1", [b])).rows;
  assert.equal(other.notification_prefs.login_alerts, true);
  await assert.rejects(h.as(null, `select update_notification_prefs('{}'::jsonb)`), /not_authenticated/);
});

test("users cannot schedule or cancel deletion by editing their profile", async () => {
  const { h, a } = await setup();
  await h.db.query("select set_config('request.jwt.claim.role', '', false)");
  await h.db.query("update profiles set deletion_scheduled_at = now() + interval '7 days' where id = $1", [a]); // server
  await h.as(a, "update profiles set deletion_scheduled_at = null where id = $1", [a]); // user attempt
  const [row] = (await h.db.query("select deletion_scheduled_at from profiles where id = $1", [a])).rows;
  assert.ok(row.deletion_scheduled_at, "authenticated user must not clear the schedule");
  await h.as(a, "update profiles set name = 'Asha R' where id = $1", [a]);
  assert.equal((await h.db.query("select name from profiles where id = $1", [a])).rows[0].name, "Asha R");
});

test("revoke_all_sessions deletes only that user's sessions", async () => {
  const { h, a, b } = await setup();
  await h.db.query("insert into auth.sessions (user_id) values ($1), ($1), ($2)", [a, b]);
  const [{ n }] = (await h.db.query("select revoke_all_sessions($1) as n", [a])).rows;
  assert.equal(n, 2);
  assert.equal((await h.db.query("select count(*)::int as c from auth.sessions")).rows[0].c, 1);
});

test("public_events requires a real source URL and a start time", async () => {
  const { h } = await setup();
  await assert.rejects(h.db.query("insert into public_events (title, starts_at, url, source_host) values ('Talk', now(), 'javascript:alert(1)', 'x')"));
  await assert.rejects(h.db.query("insert into public_events (title, url, source_host) values ('Talk', 'https://lu.ma/x', 'lu.ma')"));
  await h.db.query("insert into public_events (title, starts_at, url, source_host) values ('Talk', now(), 'https://lu.ma/x', 'lu.ma')");
  await assert.rejects(h.db.query("insert into public_events (title, starts_at, url, source_host) values ('Dup', now(), 'https://lu.ma/x', 'lu.ma')"), /unique/);
});

test("login_devices only accepts sha-256 hex fingerprints", async () => {
  const { h, a } = await setup();
  await assert.rejects(h.db.query("insert into login_devices (user_id, device_hash) values ($1, 'abc')", [a]));
  await h.db.query("insert into login_devices (user_id, device_hash) values ($1, $2)", [a, "a".repeat(64)]);
});
