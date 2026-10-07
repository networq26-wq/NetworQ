const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createGoogleRouter, encrypt, decrypt, signState, readState } = require("../../api/google");

function serve(over = {}) {
  const links = new Map();
  const seen = [];
  const app = express();
  app.use(express.json());
  app.use("/api", createGoogleRouter({
    clientId: "cid", clientSecret: "csecret", secret: "s".repeat(32), appUrl: "https://app.test",
    getUser: async (t) => (t === "good" ? { id: "u1", email: "asha@acme.test" } : null),
    loadLink: async (u) => links.get(u) || null,
    saveLink: async (u, row) => links.set(u, row),
    deleteLink: async (u) => links.delete(u),
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        const p = new URLSearchParams(init.body);
        if (p.get("grant_type") === "authorization_code") return { ok: true, json: async () => ({ refresh_token: "r-123", access_token: "a1", scope: "openid https://www.googleapis.com/auth/calendar.events email", id_token: `x.${Buffer.from(JSON.stringify({ email: "asha@gmail.com" })).toString("base64url")}.y` }) };
        return over.refreshFails ? { ok: false, json: async () => ({ error: "invalid_grant" }) } : { ok: true, json: async () => ({ access_token: "a2" }) };
      }
      if (url.includes("/calendar/v3/")) return { ok: true, status: 200, json: async () => ({ hangoutLink: "https://meet.google.com/abc-defg-hij", htmlLink: "https://calendar.google.com/e/1" }) };
      return { ok: true, json: async () => ({}) };
    },
    ...over,
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = "GET", token = "good", body } = {}) => fetch(base + path, { method, redirect: "manual", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { call, links, seen, close: () => server.close() };
}

test("tokens are encrypted at rest and states are signed + expiring", () => {
  const blob = encrypt("k".repeat(32), "refresh-token");
  assert.notEqual(blob.includes("refresh-token"), true);
  assert.equal(decrypt("k".repeat(32), blob), "refresh-token");
  assert.throws(() => decrypt("x".repeat(32), blob));
  const st = signState("k".repeat(32), { uid: "u1" });
  assert.equal(readState("k".repeat(32), st).uid, "u1");
  assert.equal(readState("x".repeat(32), st), null, "tampered/other-secret state is rejected");
});

test("connect → Google consent URL (offline, calendar scope); callback stores an encrypted token", async () => {
  const s = serve();
  try {
    assert.equal((await s.call("/api/google/connect", { method: "POST", token: "" })).status, 401);
    const { url } = await (await s.call("/api/google/connect", { method: "POST", body: { from: "app" } })).json();
    const u = new URL(url);
    assert.equal(u.searchParams.get("access_type"), "offline");
    assert.match(u.searchParams.get("scope"), /calendar\.events/);
    assert.equal(u.searchParams.get("redirect_uri"), "https://app.test/api/google/callback");
    const cb = await s.call(`/api/google/callback?code=c1&state=${encodeURIComponent(u.searchParams.get("state"))}`, { token: "" });
    assert.equal(cb.status, 200);
    assert.match(await cb.text(), /networq:\/\/google-connected/);
    const row = s.links.get("u1");
    assert.equal(row.email, "asha@gmail.com");
    assert.ok(!row.refresh_token_enc.includes("r-123"), "stored encrypted");
    assert.deepEqual(await (await s.call("/api/google/status")).json(), { available: true, connected: true, email: "asha@gmail.com" });
  } finally { s.close(); }
});

test("a forged or expired state can't attach a calendar to someone", async () => {
  const s = serve();
  try {
    const bad = await s.call("/api/google/callback?code=c1&state=abc.def", { token: "" });
    assert.equal(bad.status, 400);
    assert.equal(s.links.size, 0);
  } finally { s.close(); }
});

test("meet: needs a connection, then creates a Meet event that emails the invite", async () => {
  const s = serve();
  try {
    const body = { title: "Asha <> Bob", start: new Date(Date.now() + 86400000).toISOString(), minutes: 30, attendeeEmail: "bob@acme.test" };
    const first = await s.call("/api/google/meet", { method: "POST", body });
    assert.equal(first.status, 409);
    assert.equal((await first.json()).needsConnect, true);
    const { url } = await (await s.call("/api/google/connect", { method: "POST" })).json();
    await s.call(`/api/google/callback?code=c1&state=${encodeURIComponent(new URL(url).searchParams.get("state"))}`, { token: "" });
    const ok = await (await s.call("/api/google/meet", { method: "POST", body })).json();
    assert.equal(ok.meetLink, "https://meet.google.com/abc-defg-hij");
    const ev = s.seen.find((x) => x.url.includes("/calendar/v3/"));
    assert.match(ev.url, /sendUpdates=all/);
    assert.equal(ev.init.headers.Authorization, "Bearer a2");
    assert.equal(JSON.parse(ev.init.body).attendees[0].email, "bob@acme.test");
    assert.equal((await s.call("/api/google/meet", { method: "POST", body: { ...body, attendeeEmail: "nope" } })).status, 400);
  } finally { s.close(); }
});

test("a revoked Google connection is forgotten and asks to reconnect", async () => {
  const s = serve({ refreshFails: true });
  try {
    s.links.set("u1", { refresh_token_enc: encrypt("s".repeat(32), "r-old"), email: "x@gmail.com" });
    const r = await s.call("/api/google/meet", { method: "POST", body: { title: "t", start: new Date().toISOString(), attendeeEmail: "bob@acme.test" } });
    assert.equal(r.status, 409);
    assert.equal(s.links.size, 0);
  } finally { s.close(); }
});

test("sign in with Google on our own domain: hands the ID token to the web app (fragment) or the app (deep link)", async () => {
  const s = serve({
    fetchImpl: async (url) => (url.startsWith("https://oauth2.googleapis.com/token") ? { ok: true, json: async () => ({ id_token: "ID.TOKEN.X" }) } : { ok: true, json: async () => ({}) }),
  });
  try {
    for (const from of ["web", "app"]) {
      const start = await s.call(`/api/google/signin?from=${from}`, { token: "" });
      assert.equal(start.status, 302);
      const g = new URL(start.headers.get("location"));
      assert.equal(g.hostname, "accounts.google.com");
      assert.equal(g.searchParams.get("redirect_uri"), "https://app.test/api/google/callback", "Google sees networq's domain, not Supabase");
      assert.match(g.searchParams.get("scope"), /openid email profile/);
      const cb = await s.call(`/api/google/callback?code=c1&state=${encodeURIComponent(g.searchParams.get("state"))}`, { token: "" });
      assert.equal(cb.status, 302);
      const loc = cb.headers.get("location");
      if (from === "web") assert.equal(loc, "/#google_id_token=ID.TOKEN.X");
      else assert.equal(loc, "networq://auth-callback?id_token=ID.TOKEN.X");
    }
  } finally { s.close(); }
});

test("not configured: web reports unavailable; the app is told to fall back", async () => {
  const s = serve({ clientSecret: "" });
  try {
    assert.deepEqual(await (await s.call("/api/google/available", { token: "" })).json(), { available: false });
    const r = await s.call("/api/google/signin?from=app", { token: "" });
    assert.equal(r.headers.get("location"), "networq://auth-callback?fallback=1");
  } finally { s.close(); }
});
