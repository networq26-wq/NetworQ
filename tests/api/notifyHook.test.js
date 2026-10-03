const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createNotifyHookRouter } = require("../../api/notifyHook");

function harness(overrides = {}) {
  const sent = [], marked = [];
  const db = {
    notifications: {
      n1: { id: "n1", type: "connection_request", user_id: "bob", data: { from_user: "asha", event_id: "e1" }, emailed_at: null },
      n2: { id: "n2", type: "connection_accepted", user_id: "asha", data: { from_user: "bob", event_id: "e1" }, emailed_at: null },
      n3: { id: "n3", type: "connection_request", user_id: "optout", data: { from_user: "asha" }, emailed_at: null },
    },
    people: {
      asha: { name: "Asha Rao", role: "Founder", email: "asha@acme.test" },
      bob: { name: "Bob Iyer", role: "Partner", email: "bob@acme.test" },
      optout: { name: "Quiet Person", email: "q@acme.test", notification_prefs: { connection_emails: false } },
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api", createNotifyHookRouter({
    secret: "s".repeat(64),
    appUrl: "https://app.test",
    loadNotification: async (id) => db.notifications[id] || null,
    loadPerson: async (id) => db.people[id] || null,
    loadEventName: async () => "Founders Night",
    markEmailed: async (id) => { marked.push(id); db.notifications[id].emailed_at = "now"; },
    send: async (m) => sent.push(m),
    ...overrides,
  }));
  const server = app.listen(0);
  const post = (body, secret = "s".repeat(64)) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/hooks/notification`, { method: "POST", headers: { "Content-Type": "application/json", "X-NetworQ-Hook": secret }, body: JSON.stringify(body) });
  return { sent, marked, post, close: () => server.close() };
}

test("rejects calls without the shared secret", async () => {
  const h = harness();
  try {
    assert.equal((await h.post({ notification_id: "n1" }, "wrong")).status, 401);
    assert.equal(h.sent.length, 0);
  } finally { h.close(); }
});

test("connection request email uses real names and event from the database", async () => {
  const h = harness();
  try {
    await h.post({ notification_id: "n1" });
    assert.equal(h.sent[0].to, "bob@acme.test");
    assert.equal(h.sent[0].subject, "Asha Rao wants to connect on NetworQ");
    assert.match(h.sent[0].text, /Hi Bob, Asha Rao \(Founder\) sent you a connection request at Founders Night/);
    assert.match(h.sent[0].html, /https:\/\/app\.test\/\?open=radar/);
  } finally { h.close(); }
});

test("accepted email goes to the requester; each notification is emailed once", async () => {
  const h = harness();
  try {
    await h.post({ notification_id: "n2" });
    await h.post({ notification_id: "n2" });
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].to, "asha@acme.test");
    assert.equal(h.sent[0].subject, "Bob Iyer accepted your connection request");
    assert.deepEqual(h.marked, ["n2"]);
  } finally { h.close(); }
});

test("respects the recipient's connection-email preference", async () => {
  const h = harness();
  try {
    const r = await (await h.post({ notification_id: "n3" })).json();
    assert.equal(r.email, "opted out");
    assert.equal(h.sent.length, 0);
  } finally { h.close(); }
});

// ── Push ──────────────────────────────────────────────────────────────────────
function pushHarness({ prefs = {}, tokens = [{ token: "ExponentPushToken[abc]", platform: "android" }], deadTokens = [], type = "connection_request" } = {}) {
  const pushed = [], removed = [], markedPush = [];
  const n = { id: "p1", type, user_id: "bob", title: "Asha Rao wants to connect", body: "Tap to respond", data: { from_user: "asha", screen: "radar" }, emailed_at: null, pushed_at: null };
  const h = harness({
    loadNotification: async () => n,
    loadPerson: async (id) => (id === "bob" ? { name: "Bob", email: "bob@acme.test", notification_prefs: prefs } : { name: "Asha Rao" }),
    loadTokens: async () => tokens,
    removeTokens: async (t) => removed.push(...t),
    markPushed: async (id) => { markedPush.push(id); n.pushed_at = "now"; },
    markEmailed: async () => { n.emailed_at = "now"; },
    push: { send: async (t, m) => { pushed.push({ t, m }); return { delivered: t.length - deadTokens.length, dead: deadTokens }; } },
  });
  return { ...h, pushed, removed, markedPush, n };
}

test("every notification is pushed once to the recipient's devices with a deep link", async () => {
  const h = pushHarness();
  try {
    const r = await (await h.post({ notification_id: "p1" })).json();
    assert.deepEqual(r.push, { delivered: 1, removed: 0 });
    assert.equal(h.pushed[0].m.title, "Asha Rao wants to connect");
    assert.equal(h.pushed[0].m.url, "https://app.test/?open=radar");
    assert.equal(h.pushed[0].m.data.screen, "radar");
    const again = await (await h.post({ notification_id: "p1" })).json();
    assert.equal(again.push, "already pushed");
    assert.equal(h.pushed.length, 1);
  } finally {
    h.close();
  }
});

test("reminders are pushed but not emailed by the hook; opted-out and device-less users get no push", async () => {
  const rem = pushHarness({ type: "reminder" });
  try {
    const r = await (await rem.post({ notification_id: "p1" })).json();
    assert.equal(r.email, "type");
    assert.equal(rem.pushed.length, 1);
  } finally {
    rem.close();
  }
  const off = pushHarness({ prefs: { push: false } });
  try {
    assert.equal((await (await off.post({ notification_id: "p1" })).json()).push, "opted out");
    assert.equal(off.pushed.length, 0);
  } finally {
    off.close();
  }
  const none = pushHarness({ tokens: [] });
  try {
    assert.equal((await (await none.post({ notification_id: "p1" })).json()).push, "no devices");
  } finally {
    none.close();
  }
});

test("dead tokens reported by the push service are removed", async () => {
  const h = pushHarness({ tokens: [{ token: "ExponentPushToken[a]", platform: "android" }, { token: "ExponentPushToken[gone]", platform: "android" }], deadTokens: ["ExponentPushToken[gone]"] });
  try {
    const r = await (await h.post({ notification_id: "p1" })).json();
    assert.deepEqual(r.push, { delivered: 1, removed: 1 });
    assert.deepEqual(h.removed, ["ExponentPushToken[gone]"]);
  } finally {
    h.close();
  }
});
