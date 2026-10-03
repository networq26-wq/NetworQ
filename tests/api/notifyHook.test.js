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
    assert.equal(r.skipped, "opted out");
    assert.equal(h.sent.length, 0);
  } finally { h.close(); }
});
