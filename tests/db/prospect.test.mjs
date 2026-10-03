import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const M = ["20261001_security_hardening.sql", "20261007_prospect_research.sql"];

// Run SQL as an authenticated user with RLS enforced (PGlite's default role bypasses RLS)
async function asUser(h, user, sql, params = []) {
  await h.db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await h.db.exec("set role authenticated");
  try {
    return (await h.db.query(sql, params)).rows;
  } finally {
    await h.db.exec("reset role");
  }
}

async function setup() {
  const h = await createDb(...M);
  await h.db.exec("grant usage on schema public to authenticated; grant select, insert, update on contacts to authenticated; grant select, insert, update on follow_up_emails to authenticated; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;");
  const a = await h.addUser("Asha Rao"), b = await h.addUser("Bob Iyer");
  const ca = (await h.db.query("insert into contacts (user_id, name) values ($1, 'Priya') returning id", [a])).rows[0].id;
  const cb = (await h.db.query("insert into contacts (user_id, name) values ($1, 'Ravi') returning id", [b])).rows[0].id;
  return { h, a, b, ca, cb };
}

test("organization profile is private to its owner", async () => {
  const { h, a, b } = await setup();
  await asUser(h, a, "insert into organization_profiles (user_id, company_name, services) values ($1, 'Acme Digital', '{SEO,Ads}')", [a]);
  assert.equal((await asUser(h, a, "select company_name from organization_profiles"))[0].company_name, "Acme Digital");
  assert.equal((await asUser(h, b, "select * from organization_profiles")).length, 0);
  await assert.rejects(asUser(h, b, "insert into organization_profiles (user_id, company_name) values ($1, 'Hijack')", [a]));
  await asUser(h, b, "update organization_profiles set company_name = 'Hijack' where user_id = $1", [a]);
  assert.equal((await h.db.query("select company_name from organization_profiles")).rows[0].company_name, "Acme Digital");
});

test("research can only be attached to your own contacts and is invisible to others", async () => {
  const { h, a, b, ca, cb } = await setup();
  await asUser(h, a, "insert into prospect_research (user_id, contact_id, domain) values ($1, $2, 'acme.com')", [a, ca]);
  await assert.rejects(asUser(h, a, "insert into prospect_research (user_id, contact_id) values ($1, $2)", [a, cb]), /row-level security/);
  assert.equal((await asUser(h, b, "select * from prospect_research")).length, 0);
  assert.equal((await asUser(h, a, "select domain from prospect_research"))[0].domain, "acme.com");
});

test("outreach log: own contacts only; reply status is constrained", async () => {
  const { h, a, ca, cb } = await setup();
  await asUser(h, a, "insert into follow_up_emails (user_id, contact_id, subject, draft_option, value_props) values ($1, $2, 'Hi', 'B', '{SEO}')", [a, ca]);
  await assert.rejects(asUser(h, a, "insert into follow_up_emails (user_id, contact_id, subject) values ($1, $2, 'x')", [a, cb]), /row-level security/);
  await asUser(h, a, "update follow_up_emails set reply_status = 'replied'");
  assert.equal((await h.db.query("select reply_status, delivery_status from follow_up_emails")).rows[0].reply_status, "replied");
  await assert.rejects(asUser(h, a, "update follow_up_emails set reply_status = 'opened'"), /check/);
});

test("research has its own daily cap; draft cap raised to 40", async () => {
  const { h, a } = await setup();
  let last;
  for (let i = 0; i < 21; i++) last = (await h.as(a, "select increment_ai_usage($1, 'prospect_research') as r", [a]))[0].r;
  assert.equal(last.allowed, false);
  assert.equal(last.limit, 20);
  const draft = (await h.as(a, "select increment_ai_usage($1, 'email_generation') as r", [a]))[0].r;
  assert.equal(draft.limit, 40);
});
