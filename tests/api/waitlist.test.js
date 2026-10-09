const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const waitlist = require("../../api/waitlist");
const { createMemoryStore } = require("../../api/waitlistAdmin/store");
const A = require("../../api/waitlistAdmin/auth");
const { sendWaitlistEmail, processPendingWaitlistEmails, csvCell, escapeHtml, signupDetails } = waitlist;

// Minimal in-memory stand-in for the supabase-js query builder (update/select/eq/lt/gte/order/limit)
function fakeDb(rows) {
  return {
    rows,
    from() {
      const q = { op: "select", patch: null, filters: [] };
      const cmp = { eq: (a, b) => a === b, gte: (a, b) => a >= b, lt: (a, b) => (a ?? 0) < b };
      const run = () => {
        const hit = rows.filter((r) => q.filters.every(([k, v, op]) => cmp[op](r[k], v)));
        if (q.op === "update") hit.forEach((r) => Object.assign(r, q.patch));
        return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null });
      };
      const b = {
        update(patch) { q.op = "update"; q.patch = patch; return b; },
        select() { return b; },
        eq(k, v) { q.filters.push([k, v, "eq"]); return b; },
        gte(k, v) { q.filters.push([k, v, "gte"]); return b; },
        lt(k, v) { q.filters.push([k, v, "lt"]); return b; },
        order() { return b; },
        limit() { return b; },
        then(ok, bad) { return run().then(ok, bad); },
      };
      return b;
    },
  };
}

// ── Confirmation emails ──────────────────────────────────────────────────────

test("each sign-up gets exactly one confirmation, even when join and the timer race", async () => {
  const db = fakeDb([{ email: "a@x.co", position: 1, notified: false, created_at: new Date().toISOString() }]);
  const sent = [];
  const mailer = async (m) => sent.push(m.to);
  const [r1, r2] = await Promise.all([sendWaitlistEmail(db, "A@x.co", 1, { mailer }), sendWaitlistEmail(db, "a@x.co", 1, { mailer })]);
  assert.deepEqual(sent, ["a@x.co"]);
  assert.equal([r1, r2].filter((r) => r.ok).length, 1);
  assert.equal(db.rows[0].notified, true);
});

test("a failed send is un-claimed, the error is recorded, and retries stop after 3 tries", async () => {
  const db = fakeDb([{ email: "b@x.co", position: 2, notified: false, email_attempts: 0, created_at: new Date().toISOString() }]);
  const failing = { mailer: async () => { throw new Error("smtp down"); } };
  for (let i = 0; i < 5; i++) await processPendingWaitlistEmails(db, failing);
  assert.equal(db.rows[0].notified, false);
  assert.equal(db.rows[0].email_error, "smtp down");
  assert.equal(db.rows[0].email_attempts, 3);
});

test("the background sender only emails recent sign-ups, never the whole old list", async () => {
  const old = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const db = fakeDb([
    { email: "old@x.co", position: 1, notified: false, email_attempts: 0, created_at: old },
    { email: "new@x.co", position: 2, notified: false, email_attempts: 0, created_at: new Date().toISOString() },
  ]);
  const sent = [];
  const r = await processPendingWaitlistEmails(db, { mailer: async (m) => sent.push(m.to) });
  assert.equal(r.processed, 1);
  assert.deepEqual(sent, ["new@x.co"]);
});

test("before the admin migration (no email_attempts column) confirmations still go out", async () => {
  const db = fakeDb([{ email: "pre@x.co", position: 1, notified: false, created_at: new Date().toISOString() }]);
  const from = db.from.bind(db);
  db.from = () => {
    const b = from();
    const select = b.select;
    b.select = (cols) => (cols && cols.includes("email_attempts") ? { eq: () => ({ lt: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: 'column waitlist.email_attempts does not exist' } }) }) }) }) }) } : select(cols));
    return b;
  };
  const sent = [];
  const r = await processPendingWaitlistEmails(db, { mailer: async (m) => sent.push(m.to) });
  assert.equal(r.processed, 1);
  assert.deepEqual(sent, ["pre@x.co"]);
});

test("no service key → nothing is sent", async () => {
  assert.equal((await sendWaitlistEmail(null, "c@x.co", 3)).ok, false);
  assert.equal((await processPendingWaitlistEmails(null)).processed, 0);
});

test("CSV cells are quoted and spreadsheet formulas are neutralised; HTML is escaped", () => {
  assert.equal(csvCell("a@x.co"), '"a@x.co"');
  assert.equal(csvCell('=HYPERLINK("http://evil")@x.co'), `"'=HYPERLINK(""http://evil"")@x.co"`);
  assert.equal(csvCell("+1@x.co"), `"'+1@x.co"`);
  assert.equal(escapeHtml(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

test("sign-up details: only clean, short values from the visitor's own browser", () => {
  const d = signupDetails({
    headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile" },
    body: { utm_source: " Instagram ", utm_campaign: "Launch\u0000Week", referrer: "javascript:alert(1)", tz: "Asia/Kolkata", ref: "abc12345", source: "landing" },
  });
  assert.deepEqual(d, { source: "landing", utm_source: "instagram", utm_medium: null, utm_campaign: "launchweek", referrer: null, timezone: "Asia/Kolkata", device: "mobile", ref: "abc12345" });
  assert.equal(signupDetails({ headers: {}, body: { tz: "<script>", ref: "nope" } }).timezone, null);
  assert.equal(signupDetails({ headers: { "user-agent": "Mozilla/5.0 (Macintosh)" }, body: {} }).device, "desktop");
});

// ── Admin panel ──────────────────────────────────────────────────────────────

const OWNER = { WAITLIST_ADMIN_USER: "Founder", WAITLIST_ADMIN_PASSWORD: "owner-password-1" };
const DAY = 24 * 3600 * 1000;
const uuid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function seed() {
  const now = Date.now();
  return createMemoryStore({
    signups: [
      { id: uuid(1), email: "early@gmail.com", position: 1, created_at: new Date(now - 20 * DAY).toISOString(), notified: true, ref_code: "aaaaaaaa", utm_source: "instagram" },
      { id: uuid(2), email: "cto@acme.io", position: 2, created_at: new Date(now - 3 * DAY).toISOString(), notified: true, ref_code: "bbbbbbbb", referred_by: "cccccccc", device: "desktop" },
      { id: uuid(3), email: "fan@yahoo.in", position: 3, created_at: new Date(now - 2 * DAY).toISOString(), notified: true, ref_code: "cccccccc", referrer: "https://www.linkedin.com/feed" },
      { id: uuid(4), email: "friend@acme.io", position: 4, created_at: new Date(now - 1 * DAY).toISOString(), notified: false, email_error: "mailbox full", ref_code: "dddddddd", referred_by: "cccccccc" },
      { id: uuid(5), email: '"><script>alert(1)</script>@evil.co', position: 5, created_at: new Date(now - 3600e3).toISOString(), notified: true, ref_code: "eeeeeeee" },
      { id: uuid(6), email: "=cmd@formula.co", position: 6, created_at: new Date(now - 60e3).toISOString(), notified: true, ref_code: "ffffffff" },
    ],
    users: ["early@gmail.com"],
    stats: { users_total: 12, users_new_7d: 3, active_7d: 5, active_30d: 9, contacts_total: 40, ai_30d: { card_scan: 7 } },
  });
}

async function withAdmin(fn, { env = OWNER } = {}) {
  const saved = {};
  for (const k of ["WAITLIST_ADMIN_USER", "WAITLIST_ADMIN_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY"]) saved[k] = process.env[k];
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const k of ["WAITLIST_ADMIN_USER", "WAITLIST_ADMIN_PASSWORD"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  const store = seed();
  const sent = [];
  waitlist.setAdminDeps(() => ({
    store,
    sendConfirmation: async (r) => (sent.push(["confirm", r.email]), { ok: true }),
    sendInvite: async (r) => (r.email.startsWith("friend") ? { ok: false, error: "bounced" } : (sent.push(["invite", r.email]), { ok: true })),
  }));
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/waitlist", (req, res) => waitlist(req, res));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/waitlist`;
  const form = (body, cookie, extra = {}) => ({ method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}), ...extra }, body: new URLSearchParams(body).toString() });
  const loginAs = async (id, password) => {
    const r = await fetch(`${base}/admin/login`, form({ id, password }));
    return r.status === 303 ? r.headers.get("set-cookie").split(";")[0] : null;
  };
  const get = (path, cookie) => fetch(base + path, { redirect: "manual", headers: cookie ? { cookie } : {} });
  try {
    await fn({ base, store, sent, form, loginAs, get });
  } finally {
    server.close();
    waitlist.setAdminDeps(null);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("admin is off (404) until the owner password is set", async () => {
  await withAdmin(async ({ get }) => {
    for (const p of ["/admin", "/admin/signups", "/admin/export.csv", "/export.csv"]) assert.equal((await get(p)).status, 404, p);
  }, { env: {} });
});

test("log in with ID + password; wrong details, forged and stale sessions are refused", async () => {
  await withAdmin(async ({ base, store, form, loginAs, get }) => {
    const page = await get("/admin");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Log in to NetworQ Admin/);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.equal((await get("/admin/signups")).status, 401);

    for (const [id, pw] of [["founder", "nope"], ["someone", "owner-password-1"], ["", ""]]) {
      const r = await fetch(`${base}/admin/login`, form({ id, password: pw }));
      assert.equal(r.status, 401);
      assert.match(await r.text(), /Wrong ID or password/);
    }
    assert.ok(store._state.auditLog.some((e) => e.action === "login_failed"));

    const cookie = await loginAs("FOUNDER ", "owner-password-1"); // ID is case/space-insensitive
    assert.ok(cookie);
    const home = await (await get("/admin", cookie)).text();
    assert.match(home, /Overview/);
    assert.match(home, /Sign-ups per day/);

    const [, value] = cookie.split("=");
    const [u, exp, sig] = value.split(".");
    for (const bad of [`${A.COOKIE}=${u}.${exp}.AAAA`, `${A.COOKIE}=${u}.${Number(exp) + 1}.${sig}`, `${A.COOKIE}=${Buffer.from("other").toString("base64url")}.${exp}.${sig}`]) {
      assert.equal((await get("/admin/signups", bad)).status, 401);
    }
    process.env.WAITLIST_ADMIN_PASSWORD = "a-new-password!";
    assert.equal((await get("/admin/signups", cookie)).status, 401, "changing the password signs sessions out");
    process.env.WAITLIST_ADMIN_PASSWORD = "owner-password-1";

    const out = await fetch(`${base}/admin/logout`, form({}, cookie));
    assert.match(out.headers.get("set-cookie"), new RegExp(`${A.COOKIE}=; Max-Age=0`));
  });
});

test("POSTs from another site are refused", async () => {
  await withAdmin(async ({ base, form, loginAs }) => {
    const cookie = await loginAs("founder", "owner-password-1");
    const r = await fetch(`${base}/admin/signups/bulk`, form({ ids: uuid(1), action: "delete", confirm: "DELETE" }, cookie, { Origin: "https://evil.example" }));
    assert.equal(r.status, 403);
  });
});

test("sign-ups list: filters, escaping, joined-app sync, referrals", async () => {
  await withAdmin(async ({ loginAs, get }) => {
    const cookie = await loginAs("founder", "owner-password-1");
    const html = await (await get("/admin/signups", cookie)).text();
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&quot;&gt;&lt;script&gt;/);
    assert.match(html, /Joined app/); // early@gmail.com has an app account
    const companies = await (await get("/admin/signups?q=acme.io", cookie)).text();
    assert.match(companies, /2 of 6 match/);
    const week = await (await get("/admin/signups?range=7d&status=waiting", cookie)).text();
    assert.match(week, /5 of 6 match/);
  });
});

test("bulk invite, tags, status and delete (with DELETE confirmation) — all logged", async () => {
  await withAdmin(async ({ base, store, sent, form, loginAs }) => {
    const cookie = await loginAs("founder", "owner-password-1");
    const post = (body) => fetch(`${base}/admin/signups/bulk`, form(body, cookie));

    let r = await fetch(`${base}/admin/signups/bulk`, { ...form({ action: "invite" }, cookie) });
    assert.match(r.headers.get("location"), /msg=none/);

    r = await post(new URLSearchParams([["ids", uuid(2)], ["ids", uuid(4)], ["action", "invite"]]));
    assert.match(r.headers.get("location"), /msg=invited&n=1&f=1/);
    assert.deepEqual(sent, [["invite", "cto@acme.io"]]);
    assert.equal(store._state.signups.find((x) => x.id === uuid(2)).status, "invited");
    assert.equal(store._state.signups.find((x) => x.id === uuid(4)).email_error, "bounced");

    await post(new URLSearchParams([["ids", uuid(3)], ["action", "tag_add"], ["tag", " VIP!! "]]));
    assert.deepEqual(store._state.signups.find((x) => x.id === uuid(3)).tags, ["vip"]);
    await post(new URLSearchParams([["ids", uuid(3)], ["action", "tag_remove"], ["tag", "vip"]]));
    assert.deepEqual(store._state.signups.find((x) => x.id === uuid(3)).tags, []);

    r = await post(new URLSearchParams([["ids", uuid(6)], ["action", "delete"]]));
    assert.match(r.headers.get("location"), /msg=confirm/);
    assert.ok(store._state.signups.find((x) => x.id === uuid(6)));
    await post(new URLSearchParams([["ids", uuid(6)], ["action", "delete"], ["confirm", "DELETE"]]));
    assert.equal(store._state.signups.find((x) => x.id === uuid(6)), undefined);

    const actions = store._state.auditLog.map((e) => e.action);
    for (const a of ["invite", "tag_add", "tag_remove", "delete"]) assert.ok(actions.includes(a), a);
  });
});

test("invite next: most referrals first, then earliest in the queue", async () => {
  await withAdmin(async ({ base, sent, form, loginAs }) => {
    const cookie = await loginAs("founder", "owner-password-1");
    await fetch(`${base}/admin/invite-next`, form({ n: "2" }, cookie));
    // fan@yahoo.in (code cccccccc) brought 2 people; then the earliest waiting (cto@acme.io — early@ has joined the app)
    assert.deepEqual(sent.map((s) => s[1]), ["fan@yahoo.in", "cto@acme.io"]);
  });
});

test("person page: notes and tags are saved; delete needs DELETE", async () => {
  await withAdmin(async ({ base, store, form, loginAs, get }) => {
    const cookie = await loginAs("founder", "owner-password-1");
    const page = await (await get(`/admin/person/${uuid(3)}`, cookie)).text();
    assert.match(page, /People they brought/);
    assert.match(page, /friend@acme\.io/);
    await fetch(`${base}/admin/person/${uuid(3)}`, form({ notes: "Met at TiE <b>", tags: "Investor, investor, college" }, cookie));
    const r = store._state.signups.find((x) => x.id === uuid(3));
    assert.equal(r.notes, "Met at TiE <b>");
    assert.deepEqual(r.tags, ["investor", "college"]);
    assert.match(await (await get(`/admin/person/${uuid(3)}`, cookie)).text(), /Met at TiE &lt;b&gt;/);
    await fetch(`${base}/admin/person/${uuid(3)}/action`, form({ action: "delete", confirm: "nope" }, cookie));
    assert.ok(store._state.signups.find((x) => x.id === uuid(3)));
  });
});

test("CSV export: needs login, follows filters, neutralises formulas; Basic ID:password works for scripts", async () => {
  await withAdmin(async ({ loginAs, get, base }) => {
    assert.equal((await get("/admin/export.csv")).status, 401);
    const cookie = await loginAs("founder", "owner-password-1");
    const csv = await (await get("/admin/export.csv?q=formula", cookie)).text();
    assert.match(csv, /^"?Position/);
    assert.match(csv, /"'=cmd@formula\.co"/);
    assert.equal(csv.trim().split("\r\n").length, 2);
    const basic = await fetch(`${base}/admin/export.csv`, { headers: { Authorization: "Basic " + Buffer.from("founder:owner-password-1").toString("base64") } });
    assert.equal(basic.status, 200);
  });
});

test("reports, app, health and activity pages render real numbers", async () => {
  await withAdmin(async ({ loginAs, get }) => {
    const cookie = await loginAs("founder", "owner-password-1");
    const reports = await (await get("/admin/reports", cookie)).text();
    assert.match(reports, /acme\.io/);
    assert.match(reports, />linkedin</);
    assert.match(reports, /instagram/);
    assert.match(reports, /mailbox full/);
    const app = await (await get("/admin/app", cookie)).text();
    assert.match(app, /Business cards scanned/);
    assert.match(app, />12</);
    const health = await (await get("/admin/health", cookie)).text();
    assert.match(health, /No email service is set up|Sends from/);
    const activity = await (await get("/admin/activity", cookie)).text();
    assert.match(activity, /Logged in/);
  });
});

test("owner adds an admin; admins can't manage admins; disabling signs them out", async () => {
  await withAdmin(async ({ base, store, form, loginAs, get }) => {
    const owner = await loginAs("founder", "owner-password-1");
    let r = await fetch(`${base}/admin/admins`, form({ username: "priya", password: "short" }, owner));
    assert.match(decodeURIComponent(r.headers.get("location")), /at least 10/);
    r = await fetch(`${base}/admin/admins`, form({ username: "Priya Admin", password: "long-enough-pass" }, owner));
    assert.match(r.headers.get("location"), /admin_error/);
    r = await fetch(`${base}/admin/admins`, form({ username: "priya", password: "long-enough-pass" }, owner));
    assert.match(r.headers.get("location"), /admin_added/);
    assert.match(store._state.admins[0].password_hash, /^scrypt\$/);
    assert.doesNotMatch(store._state.admins[0].password_hash, /long-enough-pass/);

    const priya = await loginAs("priya", "long-enough-pass");
    assert.ok(priya);
    assert.equal((await get("/admin/signups", priya)).status, 200);
    assert.equal((await get("/admin/admins", priya)).status, 303);
    assert.equal((await fetch(`${base}/admin/admins`, form({ username: "eve", password: "long-enough-pass" }, priya))).status, 403);
    assert.equal(await loginAs("priya", "wrong-password-x"), null);

    await fetch(`${base}/admin/admins/${store._state.admins[0].id}`, form({ action: "disable" }, owner));
    assert.equal((await get("/admin/signups", priya)).status, 401);
    assert.equal(await loginAs("priya", "long-enough-pass"), null);
  });
});

test("passwords are hashed with scrypt and verified in constant time", () => {
  const h = A.hashPassword("correct horse battery");
  assert.ok(A.verifyPassword("correct horse battery", h));
  assert.ok(!A.verifyPassword("correct horse batterY", h));
  assert.ok(!A.verifyPassword("x", "plain-text"));
});

test("join rejects invalid emails without touching the database", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/waitlist", (req, res) => waitlist(req, res));
  const server = app.listen(0);
  try {
    for (const email of ["", "nope", 'a"b@x.co', "<x>@y.co", "a@b"]) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/waitlist/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      assert.equal(r.status, 400, email);
    }
  } finally {
    server.close();
  }
});
