const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { runFollowups, templateEmail, writeEmail, unsubscribeUrl, createFollowupsRouter, PER_USER_DAILY } = require("../../api/followups");

process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-key";
delete process.env.GROQ_API_KEY; // template emails unless a test opts in

// Small in-memory stand-in for the supabase-js query builder
function fakeSupabase(tables, users = {}) {
  const t = (name) => (tables[name] = tables[name] || []);
  return {
    tables,
    auth: { admin: { getUserById: async (id) => ({ data: { user: users[id] ? { id, email: users[id] } : null } }) }, getUser: async (tok) => (tok === "tok-u1" ? { data: { user: { id: "u1" } } } : { data: null, error: { message: "bad" } }) },
    from(name) {
      const q = { op: "select", filters: [], patch: null, rows: null, head: false, single: false, limit: Infinity, order: null };
      const match = (r) =>
        q.filters.every(([k, op, v]) => {
          const x = r[k];
          if (op === "eq") return x === v;
          if (op === "lte") return x !== null && x !== undefined && String(x) <= String(v);
          if (op === "gte") return String(x) >= String(v);
          if (op === "in") return v.includes(x);
          if (op === "notnull") return x !== null && x !== undefined;
          if (op === "ilike") return String(x || "").toLowerCase() === String(v).replace(/\\(.)/g, "$1").toLowerCase();
          return true;
        });
      const run = async () => {
        if (q.op === "insert") {
          for (const r of q.rows) t(name).push({ id: `${name}-${t(name).length + 1}`, created_at: new Date().toISOString(), ...r });
          return { data: q.rows, error: null };
        }
        if (q.op === "upsert") {
          for (const r of q.rows) if (!t(name).some((x) => x.email === r.email)) t(name).push(r);
          return { data: q.rows, error: null };
        }
        let hit = t(name).filter(match);
        if (q.op === "update") hit.forEach((r) => Object.assign(r, q.patch));
        if (q.order) hit = [...hit].sort((a, b) => String(a[q.order]).localeCompare(String(b[q.order])));
        hit = hit.slice(0, q.limit);
        if (q.head) return { count: hit.length, data: null, error: null };
        if (q.single) return { data: hit[0] || null, error: null };
        return { data: hit.map((r) => ({ ...r })), error: null };
      };
      const b = {
        select(_c, opts) { if (opts?.head) q.head = true; return b; },
        insert(rows) { q.op = "insert"; q.rows = [].concat(rows); return b; },
        upsert(rows) { q.op = "upsert"; q.rows = [].concat(rows); return b; },
        update(p) { q.op = "update"; q.patch = p; return b; },
        eq(k, v) { q.filters.push([k, "eq", v]); return b; },
        lte(k, v) { q.filters.push([k, "lte", v]); return b; },
        gte(k, v) { q.filters.push([k, "gte", v]); return b; },
        in(k, v) { q.filters.push([k, "in", v]); return b; },
        not(k) { q.filters.push([k, "notnull"]); return b; },
        ilike(k, v) { q.filters.push([k, "ilike", v]); return b; },
        order(k) { q.order = k; return b; },
        limit(n) { q.limit = n; return b; },
        maybeSingle() { q.single = true; return b; },
        then(ok, bad) { return run().then(ok, bad); },
      };
      return b;
    },
  };
}

const NOW = new Date("2026-10-10T10:00:00Z");
const DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString();

function world(extra = {}) {
  const added = NOW.getTime() - 1.5 * DAY;
  return fakeSupabase(
    {
      profiles: [
        { id: "u1", name: "Asha Rao", role: "Founder", company: "Acme Labs", autopilot_enabled: true, autopilot_days: [1, 7, 30], autopilot_signature: "Asha · acme.io" },
        { id: "u2", name: "Bob Off", autopilot_enabled: false, autopilot_days: [1, 7, 30] },
      ],
      contacts: [
        { id: "c1", user_id: "u1", name: "Ravi Kumar", company: "Kumar AI", email: "Ravi@Kumar.test", event: "TiE Hyderabad", reference: "AI infra", added_at: iso(added), autopilot_step: 0, autopilot_status: "active", autopilot_next_at: iso(added + DAY) },
        { id: "c2", user_id: "u1", name: "No Email", email: null, added_at: iso(added), autopilot_step: 0, autopilot_status: "active", autopilot_next_at: iso(added + DAY) },
        { id: "c3", user_id: "u1", name: "Paused", email: "p@x.test", added_at: iso(added), autopilot_step: 0, autopilot_status: "paused", autopilot_next_at: iso(added + DAY) },
        { id: "c4", user_id: "u1", name: "Not yet", email: "later@x.test", added_at: iso(NOW.getTime()), autopilot_step: 0, autopilot_status: "active", autopilot_next_at: iso(NOW.getTime() + DAY) },
        { id: "c5", user_id: "u2", name: "Bob's contact", email: "b@x.test", added_at: iso(added), autopilot_step: 0, autopilot_status: "active", autopilot_next_at: iso(added + DAY) },
        ...(extra.contacts || []),
      ],
      followup_log: [...(extra.log || [])],
      followup_optouts: [...(extra.optouts || [])],
    },
    { u1: "asha@acme.io", u2: "bob@x.test" }
  );
}

test("sends only due, active contacts with an email, for users who turned autopilot on", async () => {
  const sb = world();
  const sent = [];
  const r = await runFollowups({ supabase: sb, mailer: async (m) => sent.push(m), appUrl: "https://app.test", now: NOW });
  assert.deepEqual(r, { sent: 1, failed: 0, skipped: 0, stopped: 0 });
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, "ravi@kumar.test");
  assert.equal(m.fromName, "Asha Rao via NetworQ");
  assert.equal(m.replyTo, "asha@acme.io");
  assert.match(m.subject, /TiE Hyderabad/);
  assert.match(m.text, /Hi Ravi/);
  assert.match(m.text, /Asha · acme\.io/); // signature
  assert.match(m.headers["List-Unsubscribe"], /^<https:\/\/app\.test\/api\/followups\/unsubscribe\?t=/);
  assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(m.html, /Unsubscribe/);

  const c1 = sb.tables.contacts.find((c) => c.id === "c1");
  assert.equal(c1.autopilot_step, 1);
  assert.equal(c1.email_sent, true);
  // next step: day 7 after the contact was added
  assert.equal(c1.autopilot_next_at, iso(new Date(c1.added_at).getTime() + 7 * DAY));
  assert.equal(sb.tables.followup_log.filter((l) => l.status === "sent").length, 1);
  assert.equal(sb.tables.contacts.find((c) => c.id === "c5").autopilot_step, 0, "autopilot off → nothing sent");
});

test("runs the whole Day 1 → 7 → 30 sequence, then stops", async () => {
  const sb = world();
  const sent = [];
  const mailer = async (m) => m.to === "ravi@kumar.test" && sent.push(m.subject);
  const c1 = () => sb.tables.contacts.find((c) => c.id === "c1");
  const added = new Date(c1().added_at).getTime();
  for (const at of [NOW.getTime(), added + 7 * DAY + 60e3, added + 30 * DAY + 60e3, added + 60 * DAY]) {
    await runFollowups({ supabase: sb, mailer, appUrl: "https://app.test", now: new Date(at) });
  }
  assert.equal(sent.length, 3);
  assert.equal(c1().autopilot_status, "done");
  assert.equal(c1().autopilot_next_at, null);
  assert.deepEqual(sb.tables.followup_log.filter((l) => l.contact_id === "c1").map((l) => l.step), [1, 2, 3]);
});

test("unsubscribed addresses are never emailed; the contact is marked opted out", async () => {
  const sb = world({ optouts: [{ email: "ravi@kumar.test" }] });
  const sent = [];
  const r = await runFollowups({ supabase: sb, mailer: async (m) => sent.push(m), appUrl: "https://app.test", now: NOW });
  assert.equal(sent.length, 0);
  assert.equal(r.skipped, 1);
  assert.equal(sb.tables.contacts.find((c) => c.id === "c1").autopilot_status, "opted_out");
});

test(`daily limit: at most ${PER_USER_DAILY} autopilot emails per user per day`, async () => {
  const log = Array.from({ length: PER_USER_DAILY }, (_, i) => ({ id: `l${i}`, user_id: "u1", status: "sent", created_at: iso(NOW.getTime() - 3600e3) }));
  const sb = world({ log });
  const sent = [];
  await runFollowups({ supabase: sb, mailer: async (m) => sent.push(m), appUrl: "https://app.test", now: NOW });
  assert.equal(sent.length, 0);
  assert.equal(sb.tables.contacts.find((c) => c.id === "c1").autopilot_step, 0);
});

test("a failed send retries later; 3 failures pause that contact", async () => {
  const sb = world();
  const failing = async () => { throw new Error("Resend 500"); };
  const c1 = () => sb.tables.contacts.find((c) => c.id === "c1");
  let at = NOW.getTime();
  for (let i = 0; i < 3; i++) {
    await runFollowups({ supabase: sb, mailer: failing, appUrl: "https://app.test", now: new Date(at) });
    at += 7 * 3600e3;
  }
  assert.equal(c1().autopilot_status, "paused");
  assert.equal(c1().autopilot_step, 0);
  assert.equal(sb.tables.followup_log.filter((l) => l.status === "failed").length, 3);
});

test("two servers running at once send each email only once", async () => {
  const sb = world();
  const sent = [];
  const mailer = async (m) => sent.push(m.to);
  await Promise.all([runFollowups({ supabase: sb, mailer, appUrl: "https://app.test", now: NOW }), runFollowups({ supabase: sb, mailer, appUrl: "https://app.test", now: NOW })]);
  assert.deepEqual(sent, ["ravi@kumar.test"]);
});

test("templates never leave placeholders and use only saved facts", () => {
  for (const index of [0, 1, 2]) {
    const e = templateEmail({ user: { name: "Asha Rao" }, contact: { name: "Ravi Kumar" }, index, total: 3 });
    assert.doesNotMatch(e.body + e.subject, /\[|\]|undefined|null/);
    assert.match(e.body, /Asha$/);
  }
});

test("AI email: uses the model's JSON; falls back to the template on junk or placeholders", async () => {
  process.env.GROQ_API_KEY = "k";
  const reply = (content) => async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  const ctx = { user: { name: "Asha Rao" }, contact: { name: "Ravi Kumar", event: "TiE" }, index: 0, total: 3 };
  const good = await writeEmail({ ...ctx, fetchImpl: reply('{"subject":"Great meeting you at TiE","body":"Hi Ravi, it was great to meet you at TiE and hear about your work. Would a short call next week help? Best, Asha"}') });
  assert.equal(good.ai, true);
  assert.equal(good.subject, "Great meeting you at TiE");
  const placeholder = await writeEmail({ ...ctx, fetchImpl: reply('{"subject":"Hi","body":"Hi [Name], great to meet you at [Event], let us talk soon about everything. Best"}') });
  assert.equal(placeholder.ai, false);
  const junk = await writeEmail({ ...ctx, fetchImpl: reply("sorry, I can't") });
  assert.equal(junk.ai, false);
  delete process.env.GROQ_API_KEY;
});

function http() {
  const sb = world();
  const app = express();
  app.use(express.json());
  app.use("/api", createFollowupsRouter({ express, supabase: sb, appUrl: "https://app.test", getUser: async (t) => (t === "tok-u1" ? "u1" : null) }));
  const server = app.listen(0);
  return { sb, base: `http://127.0.0.1:${server.address().port}/api/followups`, close: () => server.close() };
}

test("unsubscribe: GET asks to confirm (link scanners don't unsubscribe); POST and one-click POST opt out", async () => {
  const h = http();
  try {
    const url = unsubscribeUrl("https://app.test", "Ravi@Kumar.test", "c1").replace("https://app.test/api/followups", h.base);
    const get = await fetch(url);
    assert.equal(get.status, 200);
    assert.match(await get.text(), /Stop these emails\?/);
    assert.equal(h.sb.tables.followup_optouts.length, 0);

    const post = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
    assert.equal(post.status, 200);
    assert.deepEqual(h.sb.tables.followup_optouts.map((o) => o.email), ["ravi@kumar.test"]);
    assert.equal(h.sb.tables.contacts.find((c) => c.id === "c1").autopilot_status, "opted_out");

    const forged = await fetch(`${h.base}/unsubscribe?t=abc.def`, { method: "POST" });
    assert.equal(forged.status, 400);
  } finally {
    h.close();
  }
});

test("preview: signed-in users see what would be sent; nothing is sent; others are refused", async () => {
  const h = http();
  try {
    const anon = await fetch(`${h.base}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(anon.status, 401);
    const r = await fetch(`${h.base}/preview`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer tok-u1" }, body: JSON.stringify({ contact_id: "c1", step: 1 }) });
    const j = await r.json();
    assert.equal(j.to, "Ravi Kumar");
    assert.equal(j.step, 2);
    assert.equal(j.day, 7);
    assert.match(j.body, /Asha · acme\.io/);
    assert.equal(h.sb.tables.followup_log.length, 0);
    // someone else's contact id → falls back to the user's own latest contact, never leaks another user's
    const other = await (await fetch(`${h.base}/preview`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer tok-u1" }, body: JSON.stringify({ contact_id: "c5" }) })).json();
    assert.notEqual(other.to, "Bob's contact");
  } finally {
    h.close();
  }
});
