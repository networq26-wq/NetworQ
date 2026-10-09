import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const M = ["20261001_security_hardening.sql", "20261002_event_radar.sql", "20261005_connections_dedupe.sql", "20261003_account_email_events.sql", "20261006_realtime_notifications.sql",
           "20261008_nearby_radar.sql", "20261010_push_notifications.sql", "20261011_realtime_chat.sql", "20261012_chat_hardening.sql", "20261013_calls.sql", "20261014_release_hardening.sql", "20261019_group_calls.sql"];
const rpc = async (h, u, fn, args = "", params = []) => (await h.as(u, `select ${fn}(${args}) as r`, params))[0].r;

async function connect(h, a, b) {
  const ev = await rpc(h, a, "create_event", `'E ${b.slice(0, 6)}', null, null, null`);
  await rpc(h, b, "join_event_by_code", `'${ev.join_code}'`);
  const r = await rpc(h, a, "send_connection_request", `'${ev.id}', '${b}'`);
  await rpc(h, b, "respond_connection_request", `'${r.id}', true`);
}
async function setup() {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao"), b = await h.addUser("Bob Iyer"), c = await h.addUser("Cara Nair"), d = await h.addUser("Dev Shah");
  await connect(h, a, b);
  await connect(h, a, c);
  return { h, a, b, c, d };
}
const start = (h, u, ids, kind = "video") => rpc(h, u, "start_group_call", "$1::uuid[], $2", [ids, kind]);

test("host invites connections; each invitee is rung with a push-able notification", async () => {
  const { h, a, b, c } = await setup();
  const g = await start(h, a, [b, c]);
  assert.equal(g.status, "active");
  const members = await h.as(a, "select user_id, status from group_call_members where call_id = $1 order by status", [g.id]);
  assert.equal(members.length, 3);
  assert.equal(members.filter((m) => m.status === "ringing").length, 2);
  const n = await h.as(b, "select type, body, data from notifications where dedupe_key = $1", [`gcall:${g.id}`]);
  assert.equal(n[0].type, "call");
  assert.equal(n[0].body, "Incoming group video call");
  assert.equal(n[0].data.group_call_id, g.id);
});

test("rules: 2–5 people, only connections, nobody blocked", async () => {
  const { h, a, b, c, d } = await setup();
  await assert.rejects(start(h, a, [b]), /too_few_people/);
  await assert.rejects(start(h, a, [b, d]), /not_connected/);
  await rpc(h, c, "block_user", `'${a}'`);
  await assert.rejects(start(h, a, [b, c]), /unavailable/);
});

test("join, leave, and the call ends when nobody is left; ringing people are marked missed", async () => {
  const { h, a, b, c } = await setup();
  const g = await start(h, a, [b, c], "audio");
  assert.equal((await rpc(h, b, "join_group_call", "$1::uuid", [g.id])).status, "joined");
  await assert.rejects(rpc(h, (await h.addUser("Stranger")), "join_group_call", "$1::uuid", [g.id]), /not_found/);
  await rpc(h, a, "leave_group_call", "$1::uuid", [g.id]);
  assert.equal((await h.db.query("select status from group_calls where id = $1", [g.id])).rows[0].status, "active", "Bob is still in");
  await rpc(h, b, "leave_group_call", "$1::uuid", [g.id]);
  assert.equal((await h.db.query("select status from group_calls where id = $1", [g.id])).rows[0].status, "ended");
  const cara = (await h.db.query("select status from group_call_members where call_id = $1 and user_id = $2", [g.id, c])).rows[0];
  assert.equal(cara.status, "missed");
  assert.equal((await rpc(h, c, "join_group_call", "$1::uuid", [g.id])).status, "ended");
});

test("signalling channel: members of an active call only", async () => {
  const { h, a, b, d } = await setup();
  const { c } = { c: (await h.db.query("select id from auth.users offset 2 limit 1")).rows[0].id };
  const g = await start(h, a, [b, c]);
  const allowed = async (u) => (await h.as(u, "select realtime_topic_allowed($1) as ok", [`gcall:${g.id}`]))[0].ok;
  assert.equal(await allowed(a), true);
  assert.equal(await allowed(b), true);
  assert.equal(await allowed(d), false);
  assert.equal((await h.as(a, "select realtime_topic_allowed('gcall:not-a-uuid') as ok"))[0].ok, false);
});

test("people only see calls they're in", async () => {
  const { h, a, b, c, d } = await setup();
  await start(h, a, [b, c]);
  await h.db.exec("grant usage on schema public to authenticated");
  const see = async (u) => {
    await h.db.query("select set_config('request.jwt.claim.sub', $1, false)", [u]);
    await h.db.exec("set role authenticated");
    try { return (await h.db.query("select id from group_calls")).rows.length; } finally { await h.db.exec("reset role"); }
  };
  assert.equal(await see(b), 1);
  assert.equal(await see(d), 0);
});
