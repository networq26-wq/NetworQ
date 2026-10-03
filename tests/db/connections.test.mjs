import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const rpc = async (h, user, fn, args = "") => (await h.as(user, `select ${fn}(${args}) as r`))[0].r;

test("a pair connects once across events; no duplicate contacts; status shows connected", async () => {
  const h = await createDb("20261002_event_radar.sql", "20261005_connections_dedupe.sql");
  const a = await h.addUser("Asha Rao"), b = await h.addUser("Bob Iyer");
  const ev1 = await rpc(h, a, "create_event", "'Night One', null, null, null");
  await rpc(h, b, "join_event_by_code", `'${ev1.join_code}'`);
  const r1 = await rpc(h, a, "send_connection_request", `'${ev1.id}', '${b}'`);
  await rpc(h, b, "respond_connection_request", `'${r1.id}', true`);

  const ev2 = await rpc(h, a, "create_event", "'Night Two', null, null, null");
  await rpc(h, b, "join_event_by_code", `'${ev2.join_code}'`);
  const again = await rpc(h, a, "send_connection_request", `'${ev2.id}', '${b}'`);
  assert.equal(again.status, "accepted");
  assert.equal(again.already_connected, true);

  const statusA = await rpc(h, a, "my_connection_requests", `'${ev2.id}'`);
  assert.deepEqual(statusA.outgoing.map((o) => [o.to_user, o.status]), [[b, "accepted"]]);
  const inboxB = await rpc(h, b, "my_connection_requests", `'${ev2.id}'`);
  assert.equal(inboxB.incoming.length, 0, "no fresh request for an existing connection");

  const { rows } = await h.db.query("select user_id, count(*)::int n from contacts group by user_id");
  assert.deepEqual(rows.map((r) => r.n), [1, 1]);
});

test("existing duplicates are cleaned up and linked by the migration", async () => {
  const h = await createDb("20261002_event_radar.sql");
  const a = await h.addUser("Asha Rao"), b = await h.addUser("Bob Iyer");
  for (let i = 0; i < 2; i++) {
    await h.db.query("insert into contacts (user_id, name, email, reference, added_at) values ($1, 'Bob Iyer', 'BOB.IYER@acme.test', 'NetworQ Radar', now() + ($2 || ' seconds')::interval)", [a, i]);
  }
  await h.db.exec((await import("node:fs")).readFileSync(new URL("../../supabase/migrations/20261005_connections_dedupe.sql", import.meta.url), "utf8"));
  const { rows } = await h.db.query("select linked_user_id from contacts where user_id = $1", [a]);
  assert.deepEqual(rows.map((r) => r.linked_user_id), [b]);
});
