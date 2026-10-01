// Account security endpoints + transactional emails, with injected fakes (hermetic).
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { sign, verify } = require("../../api/_lib/signedLink");
const emails = require("../../api/_lib/emails");
const { createAccountRouter, deviceHash } = require("../../api/account");

const SECRET = "test-secret-please-ignore";

test("signed links verify, expire and reject tampering", () => {
  const t = sign({ u: "user-1", a: "secure" }, 60, SECRET);
  assert.deepEqual({ u: verify(t, "secure", SECRET).u }, { u: "user-1" });
  assert.equal(verify(t, "cancel_delete", SECRET), null, "wrong action");
  assert.equal(verify(t + "x", "secure", SECRET), null, "tampered signature");
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "victim", a: "secure", exp: 9e12 })).toString("base64url");
  assert.equal(verify(`${forged}.${sig}`, "secure", SECRET), null, "forged payload");
  assert.equal(verify(sign({ u: "u", a: "secure" }, -1, SECRET), "secure", SECRET), null, "expired");
  assert.equal(verify("garbage", "secure", SECRET), null);
});

test("device fingerprint is stable per user+agent and differs across users", () => {
  const a = deviceHash("u1", "Mozilla/5.0 (Linux; Android 14) Chrome/130", "en-IN");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, deviceHash("u1", "Mozilla/5.0 (Linux; Android 14) Chrome/130", "en-IN"));
  assert.notEqual(a, deviceHash("u2", "Mozilla/5.0 (Linux; Android 14) Chrome/130", "en-IN"));
});

test("every template renders HTML + text with its CTA and escapes user input", async () => {
  const name = `<script>alert(1)</script>`;
  const cases = [
    emails.welcome({ name, appUrl: "https://app.test" }),
    emails.newSignIn({ name, device: "Chrome on Android", when: "1 Oct 2026, 10:00", city: "Hyderabad", secureUrl: "https://app.test/secure?t=abc" }),
    emails.passwordChanged({ name, when: "1 Oct 2026, 10:00", secureUrl: "https://app.test/secure?t=abc" }),
    emails.deletionScheduled({ name, date: "8 Oct 2026", cancelUrl: "https://app.test/cancel?t=abc" }),
  ];
  for (const tpl of cases) {
    const { subject, html, text } = await emails.render(tpl);
    assert.ok(subject.length > 5, "subject");
    assert.ok(html.includes("<html") && html.length > 500, "html");
    assert.ok(!html.includes("<script>alert(1)</script>"), "escaped");
    assert.ok(text.length > 40 && !/<(html|body|div|table|a\s)/i.test(text), "plain text has no markup");
    assert.ok(html.includes(tpl.cta.url.replace(/&/g, "&amp;")), "cta link present");
  }
});

// ── Endpoint harness with fakes ───────────────────────────────────────────────
function harness() {
  const users = {
    "tok-asha": { id: "asha", email: "asha@acme.test", app_metadata: { providers: ["email"] } },
    "tok-gina": { id: "gina", email: "gina@gmail.test", app_metadata: { providers: ["google"] } },
  };
  const state = { devices: [], profiles: { asha: { name: "Asha Rao", notification_prefs: { login_alerts: true }, deletion_scheduled_at: null }, gina: { name: "Gina Paul", notification_prefs: { login_alerts: true } } }, revoked: [], resets: [], sent: [], setupLinks: [] };
  const deps = {
    secret: SECRET,
    appUrl: "https://app.test",
    async getUser(token) {
      return users[token] || null;
    },
    store: {
      async listDevices(userId) {
        return state.devices.filter((d) => d.user_id === userId);
      },
      async upsertDevice(userId, hash, ua) {
        const d = state.devices.find((x) => x.user_id === userId && x.device_hash === hash);
        if (d) d.last_seen = Date.now();
        else state.devices.push({ user_id: userId, device_hash: hash, user_agent: ua });
      },
      async getProfile(userId) {
        return state.profiles[userId] || null;
      },
      async setDeletion(userId, at) {
        state.profiles[userId].deletion_scheduled_at = at;
      },
      async revokeSessions(userId) {
        state.revoked.push(userId);
      },
      async sendPasswordReset(email) {
        state.resets.push(email);
      },
      async passwordSetupLink(email) {
        state.setupLinks.push(email);
        return "https://jp.supabase.co/auth/v1/verify?token=abc&type=recovery&redirect_to=https://app.test";
      },
      async getEmail(userId) {
        return Object.values(users).find((u) => u.id === userId)?.email;
      },
    },
    async send(msg) {
      state.sent.push(msg);
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api", createAccountRouter(deps));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = (path, { token, body, method = "POST", ua = "Mozilla/5.0 Chrome/130 Android" } = {}) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", "User-Agent": ua, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { state, call, close: () => server.close() };
}

test("session events require a valid session", async () => {
  const h = harness();
  try {
    assert.equal((await h.call("/auth/session-event", { body: { type: "signed_in" } })).status, 401);
    assert.equal((await h.call("/auth/session-event", { token: "nope", body: { type: "signed_in" } })).status, 401);
    assert.equal((await h.call("/auth/session-event", { token: "tok-asha", body: { type: "hack" } })).status, 400);
  } finally {
    h.close();
  }
});

test("first sign-in sends a welcome email once; same device later sends nothing", async () => {
  const h = harness();
  try {
    const r1 = await (await h.call("/auth/session-event", { token: "tok-asha", body: { type: "signed_in" } })).json();
    assert.deepEqual(r1, { ok: true, first_login: true, new_device: false });
    assert.equal(h.state.sent.length, 1);
    assert.match(h.state.sent[0].subject, /Welcome/);
    assert.equal(h.state.sent[0].to, "asha@acme.test");
    await h.call("/auth/session-event", { token: "tok-asha", body: { type: "signed_in" } });
    assert.equal(h.state.sent.length, 1);
  } finally {
    h.close();
  }
});

test("a new device triggers a sign-in alert with a working 'secure my account' link", async () => {
  const h = harness();
  try {
    await h.call("/auth/session-event", { token: "tok-asha", body: { type: "signed_in" } });
    const r = await (await h.call("/auth/session-event", { token: "tok-asha", ua: "Mozilla/5.0 (Windows NT 10.0) Firefox/131", body: { type: "signed_in" } })).json();
    assert.equal(r.new_device, true);
    const alert = h.state.sent[1];
    assert.match(alert.subject, /New sign-in/);
    assert.match(alert.text, /Firefox on Windows/);
    const link = alert.html.match(/https:\/\/app\.test\/api\/account\/secure\?t=[A-Za-z0-9_.-]+/)[0];
    const secure = await h.call(link.replace("https://app.test/api", ""), { method: "GET" });
    assert.equal(secure.status, 200);
    assert.deepEqual(h.state.revoked, ["asha"]);
    assert.deepEqual(h.state.resets, ["asha@acme.test"]);
  } finally {
    h.close();
  }
});

test("sign-in alerts respect the user's notification preference", async () => {
  const h = harness();
  try {
    h.state.profiles.asha.notification_prefs.login_alerts = false;
    await h.call("/auth/session-event", { token: "tok-asha", body: { type: "signed_in" } });
    await h.call("/auth/session-event", { token: "tok-asha", ua: "Other/1.0", body: { type: "signed_in" } });
    assert.equal(h.state.sent.filter((m) => /New sign-in/.test(m.subject)).length, 0);
  } finally {
    h.close();
  }
});

test("password-changed notice is sent to the account email", async () => {
  const h = harness();
  try {
    await h.call("/auth/session-event", { token: "tok-asha", body: { type: "password_changed" } });
    assert.match(h.state.sent.at(-1).subject, /password was changed/i);
  } finally {
    h.close();
  }
});

test("secure link rejects bad tokens without side effects", async () => {
  const h = harness();
  try {
    const res = await h.call("/account/secure?t=bad.token", { method: "GET" });
    assert.equal(res.status, 400);
    assert.deepEqual(h.state.revoked, []);
  } finally {
    h.close();
  }
});

test("delete schedules 7 days out, signs out everywhere, emails a cancel link; cancel clears it", async () => {
  const h = harness();
  try {
    const r = await (await h.call("/account/delete", { token: "tok-asha", body: { confirm: "DELETE" } })).json();
    const days = (new Date(r.scheduled_for) - Date.now()) / 86400000;
    assert.ok(days > 6.9 && days < 7.1);
    assert.deepEqual(h.state.revoked, ["asha"]);
    const mail = h.state.sent.at(-1);
    assert.match(mail.subject, /deletion/i);
    const cancel = mail.html.match(/https:\/\/app\.test\/api\/account\/cancel-deletion\?t=[A-Za-z0-9_.-]+/)[0];
    assert.equal((await h.call(cancel.replace("https://app.test/api", ""), { method: "GET" })).status, 200);
    assert.equal(h.state.profiles.asha.deletion_scheduled_at, null);
  } finally {
    h.close();
  }
});

test("delete requires typing DELETE and a session", async () => {
  const h = harness();
  try {
    assert.equal((await h.call("/account/delete", { body: { confirm: "DELETE" } })).status, 401);
    assert.equal((await h.call("/account/delete", { token: "tok-asha", body: { confirm: "yes" } })).status, 400);
    assert.equal(h.state.profiles.asha.deletion_scheduled_at, null);
  } finally {
    h.close();
  }
});

test("signed-in cancel works too", async () => {
  const h = harness();
  try {
    await h.call("/account/delete", { token: "tok-asha", body: { confirm: "DELETE" } });
    const r = await h.call("/account/cancel-deletion", { token: "tok-asha" });
    assert.equal(r.status, 200);
    assert.equal(h.state.profiles.asha.deletion_scheduled_at, null);
  } finally {
    h.close();
  }
});

test("Google sign-ups get a welcome email with a secure 'Set a password' link (never a password)", async () => {
  const h = harness();
  try {
    await h.call("/auth/session-event", { token: "tok-gina", body: { type: "signed_in" } });
    const mail = h.state.sent[0];
    assert.equal(mail.to, "gina@gmail.test");
    assert.match(mail.subject, /Welcome/);
    assert.match(mail.html, /Set a password/);
    assert.ok(mail.html.includes("type=recovery"), "contains the one-time setup link");
    assert.deepEqual(h.state.setupLinks, ["gina@gmail.test"]);
    assert.doesNotMatch(mail.text, /password:\s*\S+/i, "no password in the email");
  } finally {
    h.close();
  }
});

test("email/password sign-ups get the normal welcome (no setup link)", async () => {
  const h = harness();
  try {
    await h.call("/auth/session-event", { token: "tok-asha", body: { type: "signed_in" } });
    assert.doesNotMatch(h.state.sent[0].html, /Set a password/);
    assert.deepEqual(h.state.setupLinks, []);
  } finally {
    h.close();
  }
});
