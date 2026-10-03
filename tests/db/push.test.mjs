import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const M = ["20261002_event_radar.sql", "20261005_connections_dedupe.sql", "20261003_account_email_events.sql", "20261006_realtime_notifications.sql", "20261010_push_notifications.sql"];
const call = (h, u, sql, p) => h.as(u, sql, p);
const tokens = async (h) => (await h.db.query("select token, user_id, platform from push_tokens order by token")).rows;

test("a device token belongs to whoever registered it last; only the owner can remove it", async () => {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao"), b = await h.addUser("Bob Iyer");
  await call(h, a, "select register_push_token('ExponentPushToken[phone1]', 'android')");
  assert.deepEqual((await tokens(h)).map((t) => t.user_id), [a]);
  await call(h, b, "select unregister_push_token('ExponentPushToken[phone1]')"); // not Bob's → no effect
  assert.equal((await tokens(h)).length, 1);
  await call(h, b, "select register_push_token('ExponentPushToken[phone1]', 'android')"); // Bob signs in on the same phone
  assert.deepEqual((await tokens(h)).map((t) => t.user_id), [b]);
  await call(h, b, "select unregister_push_token('ExponentPushToken[phone1]')");
  assert.equal((await tokens(h)).length, 0);
});

test("web subscriptions must match their endpoint; bad platforms and anonymous callers are refused", async () => {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao");
  await assert.rejects(call(h, a, `select register_push_token('https://push.test/1', 'web', '{"endpoint":"https://evil.test/2"}')`), /invalid_subscription/);
  await assert.rejects(call(h, a, "select register_push_token('ExponentPushToken[x1234567]', 'pager')"), /invalid_platform/);
  await assert.rejects(call(h, null, "select register_push_token('ExponentPushToken[x1234567]', 'android')"), /not_authenticated/);
  await call(h, a, `select register_push_token('https://push.test/1', 'web', '{"endpoint":"https://push.test/1","keys":{"p256dh":"k","auth":"a"}}')`);
  assert.equal((await tokens(h))[0].platform, "web");
});

test("at most 10 devices per person (oldest dropped)", async () => {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao");
  for (let i = 0; i < 12; i++) {
    await call(h, a, `select register_push_token('ExponentPushToken[device-${String(i).padStart(2, "0")}]', 'android')`);
    await h.db.query("update push_tokens set last_seen_at = now() + ($1 || ' seconds')::interval where token = $2", [i, `ExponentPushToken[device-${String(i).padStart(2, "0")}]`]);
  }
  await call(h, a, "select register_push_token('ExponentPushToken[device-11]', 'android')");
  const t = await tokens(h);
  assert.equal(t.length, 10);
  assert.ok(!t.some((x) => x.token.includes("device-00")), "oldest removed");
});

test("push preference is stored; reminders are a valid notification type", async () => {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao");
  await h.db.exec("alter table profiles add column if not exists notification_prefs jsonb");
  const prefs = (await call(h, a, `select update_notification_prefs('{"push": false}') as p`))[0].p;
  assert.equal(prefs.push, false);
  assert.equal(prefs.connection_emails, true);
  await h.db.query("insert into notifications (user_id, type, title) values ($1, 'reminder', 'Follow up with Ravi')", [a]);
});
