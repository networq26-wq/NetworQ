import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const M = ["20261001_security_hardening.sql", "20261002_event_radar.sql", "20261005_connections_dedupe.sql", "20261003_account_email_events.sql", "20261006_realtime_notifications.sql",
           "20261008_nearby_radar.sql", "20261010_push_notifications.sql", "20261011_realtime_chat.sql", "20261012_chat_hardening.sql", "20261013_calls.sql", "20261014_release_hardening.sql"];
const rpc = async (h, u, fn, args = "", params = []) => (await h.as(u, `select ${fn}(${args}) as r`, params))[0].r;
const call = (h, u, to, kind = "video") => rpc(h, u, "start_call", "$1::uuid, $2", [to, kind]);

async function setup() {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao"), b = await h.addUser("Bob Iyer"), c = await h.addUser("Cara Nair");
  const ev = await rpc(h, a, "create_event", "'Founders Night', null, null, null");
  await rpc(h, b, "join_event_by_code", `'${ev.join_code}'`);
  const r = await rpc(h, a, "send_connection_request", `'${ev.id}', '${b}'`);
  await rpc(h, b, "respond_connection_request", `'${r.id}', true`); // A and B connected; C is a stranger
  return { h, a, b, c };
}

test("connected people can call; strangers, self and bad kinds cannot", async () => {
  const { h, a, b, c } = await setup();
  const k = await call(h, a, b, "video");
  assert.equal(k.status, "ringing");
  assert.equal(k.kind, "video");
  await assert.rejects(call(h, c, a), /not_connected/);
  await assert.rejects(call(h, a, a), /invalid_recipient/);
  await assert.rejects(call(h, a, b, "fax"), /invalid_kind/);
});

test("a call rings the callee with a push-able notification", async () => {
  const { h, a, b } = await setup();
  const k = await call(h, a, b, "audio");
  const n = await h.as(b, "select type, title, body, data from notifications where dedupe_key = $1", [`call:${k.id}`]);
  assert.equal(n.length, 1);
  assert.equal(n[0].type, "call");
  assert.equal(n[0].title, "Asha Rao");
  assert.equal(n[0].body, "Incoming call");
  assert.equal(n[0].data.screen, "call");
  assert.equal(n[0].data.call_id, k.id);
});

test("callee accepts; only the callee can answer; then either side ends it", async () => {
  const { h, a, b, c } = await setup();
  const k = await call(h, a, b);
  await assert.rejects(rpc(h, a, "answer_call", "$1::uuid, true", [k.id]), /not_found/);
  await assert.rejects(rpc(h, c, "answer_call", "$1::uuid, true", [k.id]), /not_found/);
  const ok = await rpc(h, b, "answer_call", "$1::uuid, true", [k.id]);
  assert.equal(ok.status, "accepted");
  assert.ok(ok.answered_at);
  const done = await rpc(h, a, "end_call", "$1::uuid", [k.id]);
  assert.equal(done.status, "ended");
  const again = await rpc(h, b, "answer_call", "$1::uuid, true", [k.id]);
  assert.equal(again.status, "ended", "answering a finished call changes nothing");
});

test("decline, cancel and missed calls end up in the right state", async () => {
  const { h, a, b } = await setup();
  const k1 = await call(h, a, b);
  assert.equal((await rpc(h, b, "answer_call", "$1::uuid, false", [k1.id])).status, "declined");

  const k2 = await call(h, a, b);
  assert.equal((await rpc(h, a, "end_call", "$1::uuid", [k2.id])).status, "cancelled");
  const n2 = await h.as(b, "select body from notifications where dedupe_key = $1", [`call:${k2.id}`]);
  assert.equal(n2[0].body, "Missed video call");

  const k3 = await call(h, a, b);
  await h.db.query("update calls set created_at = now() - interval '2 minutes' where id = $1", [k3.id]);
  const late = await rpc(h, b, "answer_call", "$1::uuid, true", [k3.id]);
  assert.equal(late.status, "missed", "answering after 45 s is a missed call");
});

test("a new call cancels my older ringing call", async () => {
  const { h, a, b } = await setup();
  const k1 = await call(h, a, b);
  await call(h, a, b);
  const rows = (await h.db.query("select status from calls where id = $1", [k1.id])).rows;
  assert.equal(rows[0].status, "cancelled");
});

test("blocking stops calls both ways, even mid-ring", async () => {
  const { h, a, b } = await setup();
  const k = await call(h, a, b);
  await rpc(h, b, "block_user", `'${a}'`);
  await assert.rejects(call(h, a, b), /unavailable/);
  await assert.rejects(call(h, b, a), /unavailable/);
  await assert.rejects(rpc(h, b, "answer_call", "$1::uuid, true", [k.id]), /unavailable/);
});

test("rate limits: 3 rings to the same person, 10 calls overall, per 5 minutes", async () => {
  const { h, a, b } = await setup();
  for (let i = 0; i < 3; i++) await call(h, a, b);
  await assert.rejects(call(h, a, b), /rate_limited/, "4th ring to the same person");
  // overall cap: older calls to B age out of the per-pair window but still count overall
  await h.db.query("update calls set created_at = now() - interval '4 minutes'");
  const others = [];
  for (let i = 0; i < 7; i++) others.push(await h.addUser(`Friend ${i}`));
  for (const o of others) {
    const ev = await rpc(h, a, "create_event", `'Meet ${o.slice(0, 4)}', null, null, null`);
    await rpc(h, o, "join_event_by_code", `'${ev.join_code}'`);
    const r = await rpc(h, a, "send_connection_request", `'${ev.id}', '${o}'`);
    await rpc(h, o, "respond_connection_request", `'${r.id}', true`);
    await call(h, a, o);
  }
  const extra = await h.addUser("One Too Many");
  const ev = await rpc(h, a, "create_event", "'Last', null, null, null");
  await rpc(h, extra, "join_event_by_code", `'${ev.join_code}'`);
  const r = await rpc(h, a, "send_connection_request", `'${ev.id}', '${extra}'`);
  await rpc(h, extra, "respond_connection_request", `'${r.id}', true`);
  await assert.rejects(call(h, a, extra), /rate_limited/, "11th call overall");
});

test("transcription has a daily cap of 60", async () => {
  const { h, a } = await setup();
  let last;
  for (let i = 0; i < 61; i++) last = await rpc(h, a, "increment_ai_usage", "$1::uuid, 'transcribe'", [a]);
  assert.equal(last.allowed, false);
  assert.equal(last.limit, 60);
});

test("no direct writes, and people only see their own calls (RLS)", async () => {
  const { h, a, b, c } = await setup();
  const k = await call(h, a, b);
  await h.db.exec("grant usage on schema public to authenticated; grant select on calls to authenticated");
  const asRole = async (u, fn) => {
    await h.db.query("select set_config('request.jwt.claim.sub', $1, false)", [u]);
    await h.db.exec("set role authenticated");
    try { return await fn(); } finally { await h.db.exec("reset role"); }
  };
  await asRole(a, () => assert.rejects(h.db.query("insert into calls (caller_id, callee_id, kind) values ($1, $2, 'audio')", [a, b]), /permission denied/));
  await asRole(b, () => assert.rejects(h.db.query("update calls set status = 'accepted' where id = $1", [k.id]), /permission denied/));
  assert.equal((await asRole(c, () => h.db.query("select id from calls"))).rows.length, 0);
  assert.equal((await asRole(b, () => h.db.query("select id from calls"))).rows.length, 1);
});
