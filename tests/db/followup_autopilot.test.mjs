import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const setup = async () => {
  const h = await createDb("20261021_followup_autopilot.sql");
  const a = await h.addUser("Asha Rao");
  const b = await h.addUser("Bob Iyer");
  return { h, a, b };
};

test("autopilot is off by default; a new contact's first follow-up is scheduled 1 day after it was added", async () => {
  const { h, a } = await setup();
  const [p] = (await h.db.query("select autopilot_enabled, autopilot_days from profiles where id = $1", [a])).rows;
  assert.equal(p.autopilot_enabled, false);
  assert.deepEqual(p.autopilot_days, [1, 7, 30]);
  await h.db.query("insert into contacts (user_id, name, email, added_at) values ($1, 'Ravi', 'r@x.co', '2026-10-01T10:00:00Z')", [a]);
  const [c] = (await h.db.query("select autopilot_status, autopilot_step, autopilot_next_at from contacts where user_id = $1", [a])).rows;
  assert.equal(c.autopilot_status, "active");
  assert.equal(c.autopilot_step, 0);
  assert.equal(new Date(c.autopilot_next_at).toISOString(), "2026-10-02T10:00:00.000Z");
});

test("turning autopilot on never sends a burst of old follow-ups (overdue ones move to tomorrow)", async () => {
  const { h, a } = await setup();
  await h.db.query("insert into contacts (user_id, name, email, added_at) values ($1, 'Old', 'o@x.co', now() - interval '20 days')", [a]);
  const [{ r }] = await h.as(a, "select set_autopilot(true) as r");
  assert.equal(r.enabled, true);
  const [c] = (await h.db.query("select autopilot_next_at > now() + interval '23 hours' as later from contacts where user_id = $1", [a])).rows;
  assert.equal(c.later, true);
});

test("settings: schedule must be 1–5 steps between 1 and 365 days; signature is trimmed", async () => {
  const { h, a } = await setup();
  const [{ r }] = await h.as(a, "select set_autopilot(true, array[2,10], '  Asha · acme.io  ') as r");
  assert.deepEqual(r.days, [2, 10]);
  assert.equal(r.signature, "Asha · acme.io");
  await assert.rejects(h.as(a, "select set_autopilot(true, array[0])"), /autopilot_days_check/);
  await assert.rejects(h.as(a, "select set_autopilot(true, array[1,2,3,4,5,6])"), /autopilot_days_check/);
  await assert.rejects(h.as(null, "select set_autopilot(true)"), /not_authenticated/);
});

test("users can pause / resume / mark replied only their own contacts; unsubscribed contacts stay unsubscribed", async () => {
  const { h, a, b } = await setup();
  const [{ id }] = (await h.db.query("insert into contacts (user_id, name, email) values ($1, 'Ravi', 'r@x.co') returning id", [a])).rows;
  assert.equal((await h.as(a, "select set_contact_autopilot($1, 'paused') as r", [id]))[0].r.status, "paused");
  assert.equal((await h.as(a, "select set_contact_autopilot($1, 'replied') as r", [id]))[0].r.status, "replied");
  await assert.rejects(h.as(b, "select set_contact_autopilot($1, 'active')", [id]), /not_found/);
  await assert.rejects(h.as(a, "select set_contact_autopilot($1, 'done')", [id]), /invalid_status/);
  await h.db.query("update contacts set autopilot_status = 'opted_out' where id = $1", [id]);
  assert.equal((await h.as(a, "select set_contact_autopilot($1, 'active') as r", [id]))[0].r.status, "opted_out");
});

test("each user sees only their own follow-up log; nobody can read the unsubscribe list", async () => {
  const { h, a, b } = await setup();
  await h.db.query("insert into followup_log (user_id, step, to_email, status) values ($1, 1, 'x@y.co', 'sent'), ($2, 1, 'z@y.co', 'sent')", [a, b]);
  await h.db.query("insert into followup_optouts (email) values ('x@y.co')");
  await h.db.exec("grant usage on schema public to authenticated");
  await h.db.query("set role authenticated");
  await h.db.query("select set_config('request.jwt.claim.sub', $1, false)", [a]);
  const rows = (await h.db.query("select to_email from followup_log")).rows;
  assert.deepEqual(rows.map((r) => r.to_email), ["x@y.co"]);
  await assert.rejects(h.db.query("select * from followup_optouts"), /permission denied/);
  await assert.rejects(h.db.query("insert into followup_log (user_id, step, to_email, status) values ($1, 1, 'q@y.co', 'sent')", [a]), /permission denied/);
  await h.db.query("reset role");
});
