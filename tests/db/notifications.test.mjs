import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const M = ["20261002_event_radar.sql", "20261005_connections_dedupe.sql", "20261003_account_email_events.sql", "20261006_realtime_notifications.sql"];
const rpc = async (h, user, fn, args = "") => (await h.as(user, `select ${fn}(${args}) as r`))[0].r;
const notes = async (h, user) => (await h.db.query("select type, title, data, read_at from notifications where user_id = $1 order by created_at", [user])).rows;

async function setup() {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao"), b = await h.addUser("Bob Iyer"), c = await h.addUser("Cara Nair");
  const ev = await rpc(h, a, "create_event", "'Founders Night', null, null, null");
  for (const u of [b, c]) await rpc(h, u, "join_event_by_code", `'${ev.join_code}'`);
  return { h, a, b, c, ev };
}

test("request notifies the recipient once; accept notifies the sender and resolves the request notice", async () => {
  const { h, a, b, ev } = await setup();
  const r = await rpc(h, a, "send_connection_request", `'${ev.id}', '${b}'`);
  await rpc(h, a, "send_connection_request", `'${ev.id}', '${b}'`); // duplicate tap
  let nb = await notes(h, b);
  assert.equal(nb.length, 1);
  assert.equal(nb[0].type, "connection_request");
  assert.equal(nb[0].title, "Asha Rao wants to connect");
  assert.equal(nb[0].data.screen, "radar");
  assert.equal(nb[0].data.request_id, r.id);

  await rpc(h, b, "respond_connection_request", `'${r.id}', true`);
  const na = await notes(h, a);
  assert.deepEqual(na.map((n) => [n.type, n.title, n.data.screen]), [["connection_accepted", "Bob Iyer accepted your request", "contacts"]]);
  nb = await notes(h, b);
  assert.ok(nb[0].read_at, "request notice resolved after responding");
});

test("decline notifies politely and blocks re-asking for a week", async () => {
  const { h, a, b, ev } = await setup();
  const r = await rpc(h, a, "send_connection_request", `'${ev.id}', '${b}'`);
  await rpc(h, b, "respond_connection_request", `'${r.id}', false`);
  assert.equal((await notes(h, a))[0].type, "connection_declined");
  const again = await rpc(h, a, "send_connection_request", `'${ev.id}', '${b}'`);
  assert.equal(again.status, "declined");
  assert.equal((await notes(h, b)).length, 1, "no second request notice");
});

test("sender can cancel a pending request; its notice disappears; re-sending works", async () => {
  const { h, a, b, ev } = await setup();
  const r = await rpc(h, a, "send_connection_request", `'${ev.id}', '${b}'`);
  const c = await rpc(h, a, "cancel_connection_request", `'${r.id}'`);
  assert.equal(c.status, "cancelled");
  assert.equal((await notes(h, b)).length, 0);
  await assert.rejects(h.as(b, `select cancel_connection_request('${r.id}')`), /request_not_found/);
  const again = await rpc(h, a, "send_connection_request", `'${ev.id}', '${b}'`);
  assert.equal(again.status, "pending");
  assert.equal((await notes(h, b)).length, 1);
});

test("blocking hides both people from each other's Radar and stops requests both ways", async () => {
  const { h, a, b, ev } = await setup();
  const pending = await rpc(h, b, "send_connection_request", `'${ev.id}', '${a}'`);
  await rpc(h, a, "block_user", `'${b}'`);
  assert.equal((await h.db.query("select status from connection_requests where id = $1", [pending.id])).rows[0].status, "cancelled");

  const tB = (await rpc(h, b, "issue_radar_token", `'${ev.id}'`)).token;
  const tA = (await rpc(h, a, "issue_radar_token", `'${ev.id}'`)).token;
  assert.equal((await rpc(h, a, "resolve_radar_tokens", `'${ev.id}', array['${tB}']`)).people.length, 0);
  assert.equal((await rpc(h, b, "resolve_radar_tokens", `'${ev.id}', array['${tA}']`)).people.length, 0, "blocked user can't see the blocker either");
  assert.equal((await rpc(h, b, "list_event_attendees", `'${ev.id}'`)).people.some((p) => p.user_id === a), false);
  await assert.rejects(h.as(b, `select send_connection_request('${ev.id}', '${a}')`), /unavailable/);

  assert.deepEqual((await rpc(h, a, "my_blocked_users")).map((x) => x.name), ["Bob Iyer"]);
  await rpc(h, a, "unblock_user", `'${b}'`);
  assert.equal((await rpc(h, a, "resolve_radar_tokens", `'${ev.id}', array['${tB}']`)).people.length, 1);
});

test("users can only read and mark their own notifications", async () => {
  const { h, a, b, ev } = await setup();
  await rpc(h, a, "send_connection_request", `'${ev.id}', '${b}'`);
  assert.equal(await rpc(h, a, "mark_notifications_read"), 0, "A cannot mark B's notices");
  assert.equal(await rpc(h, b, "mark_notifications_read"), 1);
});

test("notification prefs include connection emails", async () => {
  const { h, a } = await setup();
  const v = await rpc(h, a, "update_notification_prefs", `'{"connection_emails": false}'::jsonb`);
  assert.equal(v.connection_emails, false);
  assert.equal(v.login_alerts, true);
});
