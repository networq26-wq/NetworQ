const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const waitlist = require("../../api/waitlist");
const { sendWaitlistEmail, processPendingWaitlistEmails, csvCell, escapeHtml } = waitlist;

// Minimal in-memory stand-in for the supabase-js query builder (update/select/eq/gte/order/limit)
function fakeDb(rows) {
  return {
    rows,
    from() {
      const q = { op: "select", patch: null, filters: [] };
      const run = () => {
        const hit = rows.filter((r) => q.filters.every(([k, v, cmp]) => (cmp === "gte" ? r[k] >= v : r[k] === v)));
        if (q.op === "update") hit.forEach((r) => Object.assign(r, q.patch));
        return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null });
      };
      const b = {
        update(patch) { q.op = "update"; q.patch = patch; return b; },
        select() { return b; },
        eq(k, v) { q.filters.push([k, v]); return b; },
        gte(k, v) { q.filters.push([k, v, "gte"]); return b; },
        order() { return b; },
        limit() { return b; },
        then(ok, bad) { return run().then(ok, bad); },
      };
      return b;
    },
  };
}

test("each sign-up gets exactly one confirmation, even when join and the timer race", async () => {
  const db = fakeDb([{ email: "a@x.co", position: 1, notified: false, created_at: new Date().toISOString() }]);
  const sent = [];
  const mailer = async (m) => sent.push(m.to);
  const [r1, r2] = await Promise.all([sendWaitlistEmail(db, "A@x.co", 1, { mailer }), sendWaitlistEmail(db, "a@x.co", 1, { mailer })]);
  assert.deepEqual(sent, ["a@x.co"]);
  assert.equal([r1, r2].filter((r) => r.ok).length, 1);
  assert.equal(db.rows[0].notified, true);
});

test("a failed send is un-claimed so it is retried later", async () => {
  const db = fakeDb([{ email: "b@x.co", position: 2, notified: false, created_at: new Date().toISOString() }]);
  const r = await sendWaitlistEmail(db, "b@x.co", 2, { mailer: async () => { throw new Error("smtp down"); } });
  assert.equal(r.ok, false);
  assert.equal(db.rows[0].notified, false);
});

test("the background sender only emails recent sign-ups, never the whole old list", async () => {
  const old = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const db = fakeDb([
    { email: "old@x.co", position: 1, notified: false, created_at: old },
    { email: "new@x.co", position: 2, notified: false, created_at: new Date().toISOString() },
  ]);
  const sent = [];
  const r = await processPendingWaitlistEmails(db, { mailer: async (m) => sent.push(m.to) });
  assert.equal(r.processed, 1);
  assert.deepEqual(sent, ["new@x.co"]);
});

test("no service key → nothing is sent", async () => {
  assert.equal((await sendWaitlistEmail(null, "c@x.co", 3)).ok, false);
  assert.equal((await processPendingWaitlistEmails(null)).processed, 0);
});

test("CSV cells are quoted and spreadsheet formulas are neutralised", () => {
  assert.equal(csvCell("a@x.co"), '"a@x.co"');
  assert.equal(csvCell('=HYPERLINK("http://evil")@x.co'), `"'=HYPERLINK(""http://evil"")@x.co"`);
  assert.equal(csvCell("+1@x.co"), `"'+1@x.co"`);
  assert.equal(csvCell("@a"), `"'@a"`);
});

test("dashboard text is HTML-escaped", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

function harness() {
  const app = express();
  app.use(express.json());
  app.use("/api/waitlist", (req, res) => waitlist(req, res));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/waitlist`;
  return { base, close: () => server.close() };
}
const basic = (pw) => ({ Authorization: "Basic " + Buffer.from(`admin:${pw}`).toString("base64") });

test("dashboard and CSV export are off (404) unless WAITLIST_ADMIN_PASSWORD is set", async () => {
  const saved = process.env.WAITLIST_ADMIN_PASSWORD;
  delete process.env.WAITLIST_ADMIN_PASSWORD;
  const h = harness();
  try {
    for (const p of ["/dashboard", "/export.csv", "/export"]) {
      const r = await fetch(h.base + p, { headers: basic("anything") });
      assert.equal(r.status, 404, p);
    }
  } finally {
    h.close();
    if (saved !== undefined) process.env.WAITLIST_ADMIN_PASSWORD = saved;
  }
});

test("dashboard and CSV export need the admin password", async () => {
  const saved = { pw: process.env.WAITLIST_ADMIN_PASSWORD, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.WAITLIST_ADMIN_PASSWORD = "correct horse battery";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const h = harness();
  try {
    for (const p of ["/dashboard", "/export.csv"]) {
      const none = await fetch(h.base + p);
      assert.equal(none.status, 401, p);
      assert.match(none.headers.get("www-authenticate") || "", /Basic/);
      assert.equal((await fetch(h.base + p, { headers: basic("wrong") })).status, 401, p);
    }
    const ok = await fetch(h.base + "/dashboard", { headers: basic("correct horse battery") });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.match(await ok.text(), /Waitlist Dashboard/);
    // a crafted URL can't reach the export through the query string
    assert.doesNotMatch((await fetch(h.base + "/?x=/export")).headers.get("content-type") || "", /csv/);
    assert.equal((await fetch(h.base + "/nope/export")).status, 404);
  } finally {
    h.close();
    for (const [k, v] of [["WAITLIST_ADMIN_PASSWORD", saved.pw], ["SUPABASE_SERVICE_ROLE_KEY", saved.key]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("join rejects invalid emails without touching the database", async () => {
  const h = harness();
  try {
    for (const email of ["", "nope", 'a"b@x.co', "<x>@y.co", "a@b"]) {
      const r = await fetch(h.base + "/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      assert.equal(r.status, 400, email);
    }
  } finally {
    h.close();
  }
});
