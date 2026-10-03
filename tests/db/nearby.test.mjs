import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const M = ["20261002_event_radar.sql", "20261005_connections_dedupe.sql", "20261003_account_email_events.sql", "20261006_realtime_notifications.sql", "20261008_nearby_radar.sql"];
const rpc = async (h, user, fn, args = "") => (await h.as(user, `select ${fn}(${args}) as r`))[0].r;

async function setup() {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao"), b = await h.addUser("Bob Iyer"), c = await h.addUser("Cara Nair");
  return { h, a, b, c };
}

test("Nearby is off by default and discoverable only when switched on", async () => {
  const { h, a, b } = await setup();
  assert.equal(await rpc(h, a, "nearby_status"), null);
  const ev = await rpc(h, a, "join_nearby");
  assert.equal((await rpc(h, a, "nearby_status")).settings.visible, false);
  assert.equal(ev.source, "nearby");
  assert.equal(ev.settings.visible, false);
  const tok = await rpc(h, a, "issue_radar_token", `'${ev.id}'`);
  assert.equal(tok.token, null, "not discoverable → no token broadcast");
  await rpc(h, a, "join_nearby", "true");
  const tokA = await rpc(h, a, "issue_radar_token", `'${ev.id}'`);
  assert.match(tokA.token, /^[0-9a-f]{16}$/);

  await rpc(h, b, "join_nearby", "true");
  const seen = await rpc(h, b, "resolve_radar_tokens", `'${ev.id}', array['${tokA.token}']`);
  assert.equal(seen.people.length, 1);
  assert.equal(seen.people[0].name, "Asha Rao");
});

test("nobody can list who is in Nearby; it never shows in my events", async () => {
  const { h, a, b, c } = await setup();
  const ev = await rpc(h, a, "join_nearby", "true");
  await rpc(h, b, "join_nearby", "true");
  await rpc(h, c, "join_nearby", "true");
  const list = await rpc(h, a, "list_event_attendees", `'${ev.id}'`);
  assert.deepEqual(list, { people: [], hidden_count: 0 });
  assert.deepEqual(await rpc(h, a, "my_events"), []);
});

test("a token you didn't detect, or from a non-discoverable person, resolves to nothing", async () => {
  const { h, a, b } = await setup();
  const ev = await rpc(h, a, "join_nearby", "true");
  await rpc(h, b, "join_nearby", "true");
  const tokB = await rpc(h, b, "issue_radar_token", `'${ev.id}'`);
  await rpc(h, b, "join_nearby", "false"); // B switches discoverable off → token revoked
  const seen = await rpc(h, a, "resolve_radar_tokens", `'${ev.id}', array['${tokB.token}', '0123456789abcdef']`);
  assert.equal(seen.people.length, 0);
});

test("requests work in Nearby; leaving removes you and your tokens", async () => {
  const { h, a, b } = await setup();
  const ev = await rpc(h, a, "join_nearby", "true");
  await rpc(h, b, "join_nearby", "true");
  const r = await rpc(h, a, "send_connection_request", `'${ev.id}', '${b}'`);
  assert.equal(r.status, "pending");
  await rpc(h, a, "issue_radar_token", `'${ev.id}'`);
  await rpc(h, a, "leave_nearby");
  assert.equal((await h.db.query("select count(*)::int n from radar_tokens where user_id = $1", [a])).rows[0].n, 0);
  await assert.rejects(rpc(h, a, "issue_radar_token", `'${ev.id}'`), /not_a_member/);
});

test("Nearby can't be entered through the listed-events path", async () => {
  const { h, a } = await setup();
  await assert.rejects(rpc(h, a, "join_listed_event", "'networq:nearby', 'Nearby'"), /invalid_event/);
});
