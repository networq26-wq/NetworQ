import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const setup = async () => {
  const h = await createDb("20261001_security_hardening.sql");
  return { h, a: await h.addUser("Asha Rao"), b: await h.addUser("Bob Iyer") };
};
const inc = async (h, as, target, action) => (await h.as(as, `select increment_ai_usage('${target}', '${action}') as r`))[0].r;

test("migration creates ai_usage on a project that never had it, and is re-runnable", async () => {
  const { h } = await setup();
  await h.db.exec((await import("node:fs")).readFileSync(new URL("../../supabase/migrations/20261001_security_hardening.sql", import.meta.url), "utf8"));
  assert.equal((await h.db.query("select to_regclass('public.ai_usage') is not null as ok")).rows[0].ok, true);
});

test("daily limits are enforced per action", async () => {
  const { h, a } = await setup();
  let r;
  for (let i = 0; i < 10; i++) r = await inc(h, a, a, "card_scan");
  assert.equal(r.allowed, true);
  r = await inc(h, a, a, "card_scan");
  assert.deepEqual({ allowed: r.allowed, used: r.used, limit: r.limit }, { allowed: false, used: 10, limit: 10 });
  for (let i = 0; i < 5; i++) r = await inc(h, a, a, "email_generation");
  assert.equal((await inc(h, a, a, "email_generation")).allowed, false);
  assert.equal((await inc(h, a, a, "email_send")).limit, 50);
});

test("a user cannot spend someone else's quota", async () => {
  const { h, a, b } = await setup();
  await assert.rejects(inc(h, a, b, "card_scan"), /another user/);
});

test("unknown actions are refused", async () => {
  const { h, a } = await setup();
  await assert.rejects(inc(h, a, a, "free_money"), /Unknown action/);
});

test("users have no insert/update policy on ai_usage (cannot reset their counter)", async () => {
  const { h } = await setup();
  const { rows } = await h.db.query("select cmd from pg_policies where tablename = 'ai_usage'");
  assert.deepEqual(rows.map((r) => r.cmd), ["SELECT"]);
});
