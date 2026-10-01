import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const rpc = async (h, user, fn, args = "") => (await h.as(user, `select ${fn}(${args}) as r`))[0].r;
const fails = async (h, user, sql, code) =>
  assert.rejects(h.as(user, sql), (e) => (code ? e.message.includes(code) : true));

async function setup() {
  const h = await createDb("20261002_event_radar.sql");
  const host = await h.addUser("Asha Rao");
  const bob = await h.addUser("Bob Iyer", "Seed Fund");
  const eve = await h.addUser("Eve Outsider");
  const ev = await rpc(h, host, "create_event", "'Founders Night', 'BHIVE', null, null");
  return { h, host, bob, eve, ev };
}

test("create_event returns a NQ- code and makes the creator a member", async () => {
  const { h, host, ev } = await setup();
  assert.match(ev.join_code, /^NQ-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  const mine = await rpc(h, host, "my_events");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].attendee_count, 1);
  assert.deepEqual(mine[0].settings, { radar_on: true, visible: true, show_distance: true, show_profile: true });
});

test("anonymous callers cannot create or join events", async () => {
  const { h } = await setup();
  await fails(h, null, "select create_event('x y', null, null, null)", "not_authenticated");
  await fails(h, null, "select join_event_by_code('NQ-AAAAAA')", "not_authenticated");
});

test("join by code is case/space-insensitive; wrong codes are counted and capped at 30/day", async () => {
  const { h, bob, eve, ev } = await setup();
  const joined = await rpc(h, bob, "join_event_by_code", `' ${ev.join_code.toLowerCase()} '`);
  assert.equal(joined.id, ev.id);
  for (let i = 0; i < 30; i++) {
    assert.deepEqual(await rpc(h, eve, "join_event_by_code", "'NQ-ZZZZZZ'"), { error: "invalid_code" });
  }
  await fails(h, eve, `select join_event_by_code('${ev.join_code}')`, "too_many_attempts");
});

test("join_listed_event upserts one event per external id", async () => {
  const { h, bob, eve } = await setup();
  const a = await rpc(h, bob, "join_listed_event", "'hyd_saas_4', 'Hyderabad SaaS Forum', 'Gachibowli', null");
  const b = await rpc(h, eve, "join_listed_event", "'hyd_saas_4', 'Spoofed Name', 'x', null");
  assert.equal(a.id, b.id);
  assert.equal(b.name, "Hyderabad SaaS Forum");
});

test("tokens: 16 hex chars, unique, 15-minute expiry", async () => {
  const { h, host } = await setup();
  const ev = (await rpc(h, host, "my_events"))[0];
  const t1 = await rpc(h, host, "issue_radar_token", `'${ev.id}'`);
  const t2 = await rpc(h, host, "issue_radar_token", `'${ev.id}'`);
  assert.match(t1.token, /^[0-9a-f]{16}$/);
  assert.notEqual(t1.token, t2.token);
  const mins = (new Date(t1.expires_at) - Date.now()) / 60000;
  assert.ok(mins > 14 && mins <= 15.1, `expiry ${mins} min`);
});

test("non-members cannot issue or resolve tokens", async () => {
  const { h, eve, ev } = await setup();
  await fails(h, eve, `select issue_radar_token('${ev.id}')`, "not_a_member");
  await fails(h, eve, `select resolve_radar_tokens('${ev.id}', array['0123456789abcdef'])`, "not_a_member");
});

test("resolve returns public profiles of same-event members only, never yourself", async () => {
  const { h, host, bob, eve, ev } = await setup();
  await rpc(h, bob, "join_event_by_code", `'${ev.join_code}'`);
  const other = await rpc(h, eve, "create_event", "'Other Event', null, null, null");
  const tBob = (await rpc(h, bob, "issue_radar_token", `'${ev.id}'`)).token;
  const tHost = (await rpc(h, host, "issue_radar_token", `'${ev.id}'`)).token;
  const tEve = (await rpc(h, eve, "issue_radar_token", `'${other.id}'`)).token;

  const res = await rpc(h, host, "resolve_radar_tokens", `'${ev.id}', array['${tBob}','${tHost}','${tEve}','ffffffffffffffff']`);
  assert.equal(res.people.length, 1);
  const p = res.people[0];
  assert.equal(p.user_id, bob);
  assert.equal(p.name, "Bob Iyer");
  assert.equal(p.company, "Seed Fund");
  assert.equal(p.token, tBob);
  assert.equal(p.email, undefined, "no contact details before consent");
  assert.equal(p.phone, undefined);
});

test("expired tokens resolve to nothing", async () => {
  const { h, host, bob, ev } = await setup();
  await rpc(h, bob, "join_event_by_code", `'${ev.join_code}'`);
  const t = (await rpc(h, bob, "issue_radar_token", `'${ev.id}'`)).token;
  await h.db.query("update radar_tokens set expires_at = now() - interval '1 second' where token = $1", [t]);
  const res = await rpc(h, host, "resolve_radar_tokens", `'${ev.id}', array['${t}']`);
  assert.equal(res.people.length, 0);
});

test("more than 64 tokens per call is rejected", async () => {
  const { h, host, ev } = await setup();
  const many = Array.from({ length: 65 }, (_, i) => `'${i.toString(16).padStart(16, "0")}'`).join(",");
  await fails(h, host, `select resolve_radar_tokens('${ev.id}', array[${many}])`, "too_many_tokens");
});

test("incognito: no token issued, hidden from others, and sees only a count", async () => {
  const { h, host, bob, ev } = await setup();
  await rpc(h, bob, "join_event_by_code", `'${ev.join_code}'`);
  const tHost = (await rpc(h, host, "issue_radar_token", `'${ev.id}'`)).token;
  const tBob = (await rpc(h, bob, "issue_radar_token", `'${ev.id}'`)).token;

  await rpc(h, bob, "update_radar_settings", `'${ev.id}', true, false, true, true`);
  assert.equal((await rpc(h, bob, "issue_radar_token", `'${ev.id}'`)).token, null);
  const seenByHost = await rpc(h, host, "resolve_radar_tokens", `'${ev.id}', array['${tBob}']`);
  assert.equal(seenByHost.people.length, 0, "going incognito revokes existing tokens");

  const bobView = await rpc(h, bob, "resolve_radar_tokens", `'${ev.id}', array['${tHost}']`);
  assert.deepEqual(bobView, { people: [], hidden_count: 1 });
});

test("radar off: cannot issue or resolve", async () => {
  const { h, host, ev } = await setup();
  await rpc(h, host, "update_radar_settings", `'${ev.id}', false, true, true, true`);
  await fails(h, host, `select issue_radar_token('${ev.id}')`, "radar_off");
  await fails(h, host, `select resolve_radar_tokens('${ev.id}', array[]::text[])`, "radar_off");
});

test("show_profile=false reduces to first name, no company/avatar; show_distance is passed through", async () => {
  const { h, host, bob, ev } = await setup();
  await rpc(h, bob, "join_event_by_code", `'${ev.join_code}'`);
  await rpc(h, bob, "update_radar_settings", `'${ev.id}', true, true, false, false`);
  const t = (await rpc(h, bob, "issue_radar_token", `'${ev.id}'`)).token;
  const [p] = (await rpc(h, host, "resolve_radar_tokens", `'${ev.id}', array['${t}']`)).people;
  assert.equal(p.name, "Bob");
  assert.equal(p.company, null);
  assert.equal(p.show_distance, false);
});

test("web fallback lists active visible members, excluding self and outsiders", async () => {
  const { h, host, bob, eve, ev } = await setup();
  await rpc(h, bob, "join_event_by_code", `'${ev.join_code}'`);
  await rpc(h, eve, "create_event", "'Elsewhere', null, null, null");
  const res = await rpc(h, host, "list_event_attendees", `'${ev.id}'`);
  assert.deepEqual(res.people.map((p) => p.user_id), [bob]);
});

test("connection flow: request → accept creates a contact for both sides with details", async () => {
  const { h, host, bob, ev } = await setup();
  await rpc(h, bob, "join_event_by_code", `'${ev.join_code}'`);
  const req = await rpc(h, host, "send_connection_request", `'${ev.id}', '${bob}'`);
  assert.equal(req.status, "pending");

  const inbox = await rpc(h, bob, "my_connection_requests", `'${ev.id}'`);
  assert.equal(inbox.incoming.length, 1);
  assert.equal(inbox.incoming[0].name, "Asha Rao");

  await fails(h, host, `select respond_connection_request('${req.id}', true)`, "request_not_found");
  const done = await rpc(h, bob, "respond_connection_request", `'${req.id}', true`);
  assert.equal(done.status, "accepted");

  const { rows } = await h.db.query("select user_id, name, email, phone, event, reference from contacts order by name");
  assert.equal(rows.length, 2);
  const hostGot = rows.find((r) => r.user_id === host);
  const bobGot = rows.find((r) => r.user_id === bob);
  assert.equal(hostGot.name, "Bob Iyer");
  assert.equal(hostGot.email, "bob.iyer@acme.test");
  assert.equal(hostGot.event, "Founders Night");
  assert.equal(hostGot.reference, "NetworQ Radar");
  assert.equal(bobGot.name, "Asha Rao");

  const again = await rpc(h, bob, "respond_connection_request", `'${req.id}', true`);
  assert.equal(again.status, "accepted");
  assert.equal((await h.db.query("select count(*)::int as n from contacts")).rows[0].n, 2, "accepting twice adds nothing");
});

test("declined requests share nothing; outsiders and self-requests are refused", async () => {
  const { h, host, bob, eve, ev } = await setup();
  await rpc(h, bob, "join_event_by_code", `'${ev.join_code}'`);
  const req = await rpc(h, host, "send_connection_request", `'${ev.id}', '${bob}'`);
  await rpc(h, bob, "respond_connection_request", `'${req.id}', false`);
  assert.equal((await h.db.query("select count(*)::int as n from contacts")).rows[0].n, 0);
  await fails(h, host, `select send_connection_request('${ev.id}', '${eve}')`, "not_a_member");
  await fails(h, host, `select send_connection_request('${ev.id}', '${host}')`, "cannot_connect_to_self");
  await fails(h, eve, `select send_connection_request('${ev.id}', '${bob}')`, "not_a_member");
});

test("leave_event removes membership and revokes tokens", async () => {
  const { h, host, bob, ev } = await setup();
  await rpc(h, bob, "join_event_by_code", `'${ev.join_code}'`);
  const t = (await rpc(h, bob, "issue_radar_token", `'${ev.id}'`)).token;
  await rpc(h, bob, "leave_event", `'${ev.id}'`);
  assert.equal((await rpc(h, host, "resolve_radar_tokens", `'${ev.id}', array['${t}']`)).people.length, 0);
  assert.equal((await rpc(h, bob, "my_events")).length, 0);
});
