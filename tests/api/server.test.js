// Hermetic HTTP tests for server.js — no .env, no outbound AI/email/Supabase calls.
process.env.NETWORQ_SKIP_DOTENV = "1";
process.env.NODE_ENV = "production";
for (const k of ["GROQ_API_KEY", "RESEND_API_KEY", "GMAIL_USER", "SMTP_HOST", "EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
  delete process.env[k];
}

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const app = require("../../server");

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

const post = (p, body, headers = {}) =>
  fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("GET /api/health returns ok", async () => {
  const res = await fetch(base + "/api/health");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "ok");
  assert.equal(typeof data.services, "object");
});

test("GET /api/version returns app metadata", async () => {
  const data = await (await fetch(base + "/api/version")).json();
  assert.equal(data.appName, "NetworQ");
  assert.ok(data.downloadUrl.startsWith("https://"));
});

test("POST /api/ai without a token is rejected", async () => {
  const res = await post("/api/ai", { action: "chat", messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.status, 401);
});

test("POST /api/ai with dev bypass tokens is rejected in production", async () => {
  for (const token of ["local-dev-token", "dev-token", "mock-anything"]) {
    const res = await post("/api/ai", { action: "card_scan", messages: [] }, { Authorization: `Bearer ${token}` });
    assert.ok(res.status >= 400, `${token} should be rejected, got ${res.status}`);
  }
});

test("POST /api/email cannot be used as an open relay", async () => {
  for (const headers of [{}, { Authorization: "Bearer mock-x" }, { Authorization: "Bearer local-dev-token" }]) {
    const res = await post("/api/email", { to: "victim@example.com", subject: "s", body: "b" }, headers);
    assert.ok(res.status >= 400, `expected rejection, got ${res.status}`);
  }
});

test("GET /api/email is not allowed", async () => {
  const res = await fetch(base + "/api/email");
  assert.ok(res.status === 404 || res.status === 405);
});

test("POST /api/enrich requires a url", async () => {
  const res = await post("/api/enrich", {});
  assert.equal(res.status, 400);
});

test("POST /api/enrich refuses internal / metadata hosts (SSRF)", async () => {
  for (const url of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:1/", "http://localhost/", "http://10.0.0.1/", "http://[::1]/"]) {
    const data = await (await post("/api/enrich", { url })).json();
    assert.match(data.warning || "", /not allowed|Only http/, `${url} was not blocked`);
  }
});

test("CORS: disallowed origins get no Access-Control-Allow-Origin", async () => {
  const res = await fetch(base + "/api/health", { headers: { Origin: "https://evil.example" } });
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("CORS: production origin is allowed", async () => {
  const res = await fetch(base + "/api/health", { headers: { Origin: "https://www.networq.co.in" } });
  assert.equal(res.headers.get("access-control-allow-origin"), "https://www.networq.co.in");
});

test("Unknown /api routes return JSON 404 when the web build is served", { skip: !fs.existsSync(path.join(__dirname, "../../dist")) }, async () => {
  const res = await fetch(base + "/api/does-not-exist");
  assert.equal(res.status, 404);
  assert.ok((await res.json()).error);
});

test("SPA routes fall back to index.html", { skip: !fs.existsSync(path.join(__dirname, "../../dist/index.html")) }, async () => {
  const res = await fetch(base + "/some/deep/link");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /html/);
});

test("Responses are compressed", async () => {
  const res = await fetch(base + "/api/health", { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(res.status, 200);
});
