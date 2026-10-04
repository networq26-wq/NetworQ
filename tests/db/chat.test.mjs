import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const M = ["20261002_event_radar.sql", "20261005_connections_dedupe.sql", "20261003_account_email_events.sql", "20261006_realtime_notifications.sql",
           "20261008_nearby_radar.sql", "20261010_push_notifications.sql", "20261011_realtime_chat.sql", "20261012_chat_hardening.sql"];
const rpc = async (h, u, fn, args = "", params = []) => (await h.as(u, `select ${fn}(${args}) as r`, params))[0].r;
const send = (h, u, to, text) => rpc(h, u, "send_chat_message", "$1::uuid, null, $2", [to, text]);

async function setup() {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao"), b = await h.addUser("Bob Iyer"), c = await h.addUser("Cara Nair");
  const ev = await rpc(h, a, "create_event", "'Founders Night', null, null, null");
  await rpc(h, b, "join_event_by_code", `'${ev.join_code}'`);
  const r = await rpc(h, a, "send_connection_request", `'${ev.id}', '${b}'`);
  await rpc(h, b, "respond_connection_request", `'${r.id}', true`); // A and B are connected; C is a stranger
  return { h, a, b, c, ev };
}

test("connected people can message; strangers and self cannot", async () => {
  const { h, a, b, c } = await setup();
  const m = await send(h, a, b, "  Great meeting you!  ");
  assert.equal(m.content, "Great meeting you!");
  assert.ok(m.chat_id);
  await assert.rejects(send(h, c, a, "hi"), /not_connected/);
  await assert.rejects(send(h, a, a, "hi"), /invalid_recipient/);
  await assert.rejects(send(h, a, b, "   "), /empty_message/);
});

test("blocking stops messages both ways and hides the conversation", async () => {
  const { h, a, b } = await setup();
  await send(h, a, b, "hello");
  await rpc(h, b, "block_user", `'${a}'`);
  await assert.rejects(send(h, a, b, "still there?"), /unavailable/);
  await assert.rejects(send(h, b, a, "hi"), /unavailable/);
  assert.deepEqual(await rpc(h, a, "my_direct_chats"), []);
});

test("no direct writes: messages can't be inserted or edited outside send_chat_message", async () => {
  const { h, a, b } = await setup();
  await h.db.exec("grant usage on schema public to authenticated");
  await h.db.query("select set_config('request.jwt.claim.sub', $1, false)", [a]);
  await h.db.exec("set role authenticated");
  try {
    await assert.rejects(h.db.query("insert into chat_messages (sender_id, recipient_id, content) values ($1, $2, 'spoof')", [a, b]), /permission denied/);
  } finally {
    await h.db.exec("reset role");
  }
});

test("event rooms: members only, never the Nearby space", async () => {
  const { h, a, c, ev } = await setup();
  const m = await rpc(h, a, "send_chat_message", `null, '${ev.id}', 'Welcome all'`);
  assert.equal(m.event_id, ev.id);
  await assert.rejects(rpc(h, c, "send_chat_message", `null, '${ev.id}', 'let me in'`), /not_a_member/);
  const nearby = await rpc(h, a, "join_nearby", "true");
  await assert.rejects(rpc(h, a, "send_chat_message", `null, '${nearby.id}', 'hello everyone nearby'`), /invalid_event/);
});

test("one live notification per conversation; reading the chat clears it", async () => {
  const { h, a, b } = await setup();
  const m1 = await send(h, a, b, "First");
  await send(h, a, b, "Second");
  let notes = (await h.db.query("select type, title, body, read_at, data from notifications where user_id = $1 and type = 'message'", [b])).rows;
  assert.equal(notes.length, 1, "grouped per conversation");
  assert.equal(notes[0].title, "Asha Rao");
  assert.equal(notes[0].body, "Second");
  assert.equal(notes[0].data.screen, "chat");
  assert.equal(notes[0].data.from_user, a);
  await rpc(h, b, "mark_chat_read", `'${m1.chat_id}'`);
  notes = (await h.db.query("select read_at from notifications where user_id = $1 and type = 'message'", [b])).rows;
  assert.ok(notes[0].read_at);
  const unread = (await h.db.query("select count(*)::int n from chat_messages where recipient_id = $1 and status <> 'read'", [b])).rows[0].n;
  assert.equal(unread, 0);
  const chats = await rpc(h, b, "my_direct_chats");
  assert.equal(chats[0].name, "Asha Rao");
  assert.equal(chats[0].last_message, "Second");
  assert.equal(chats[0].unread, 0);
});

test("rate limit: 30 messages a minute", async () => {
  const { h, a, b } = await setup();
  for (let i = 0; i < 30; i++) await send(h, a, b, `msg ${i}`);
  await assert.rejects(send(h, a, b, "one too many"), /rate_limited/);
});
