import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const M = ["20261026_content_reports.sql"];
const report = (h, user, args) => h.as(user, `select report_content(${args}) as id`);

test("a signed-in person can report a message, a person or an AI answer; it lands as 'open' for review", async () => {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao"), b = await h.addUser("Bob Iyer");
  await report(h, a, `'message', 'harassment', '${b}', gen_random_uuid(), 'keeps messaging me', 'you are useless'`);
  await report(h, a, `'user', 'spam', '${b}'`);
  await report(h, a, `'ai', 'harmful', null, null, null, 'AI said something bad'`);
  const rows = (await h.db.query("select kind, reason, status, reporter, target_user, content from content_reports order by created_at")).rows;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => [r.kind, r.reason, r.status]), [["message", "harassment", "open"], ["user", "spam", "open"], ["ai", "harmful", "open"]]);
  assert.ok(rows.every((r) => r.reporter === a));
  assert.equal(rows[0].content, "you are useless");
});

test("reports are refused when signed out, against yourself, with an unknown reason, or past 30 a day", async () => {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao"), b = await h.addUser("Bob Iyer");
  await assert.rejects(() => report(h, null, `'user', 'spam', '${b}'`), /not_signed_in/);
  await assert.rejects(() => report(h, a, `'user', 'spam', '${a}'`), /cannot_report_self/);
  await assert.rejects(() => report(h, a, `'user', 'because', '${b}'`), /check constraint/);
  for (let i = 0; i < 30; i++) await report(h, a, `'user', 'spam', '${b}'`);
  await assert.rejects(() => report(h, a, `'user', 'spam', '${b}'`), /rate_limited/);
});

test("people only see their own reports", async () => {
  const h = await createDb(...M);
  const a = await h.addUser("Asha Rao"), b = await h.addUser("Bob Iyer"), c = await h.addUser("Cara Nair");
  await report(h, a, `'user', 'spam', '${c}'`);
  await h.db.exec("grant usage on schema public to authenticated; grant select on content_reports to authenticated");
  const count = async (who) => {
    await h.db.query("select set_config('request.jwt.claim.sub', $1, false)", [who]);
    await h.db.exec("set role authenticated");
    try { return (await h.db.query("select count(*)::int as n from content_reports")).rows[0].n; } finally { await h.db.exec("reset role"); }
  };
  assert.equal(await count(b), 0);
  assert.equal(await count(a), 1);
});
