const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createIceRouter, STUN } = require("../../api/ice");

async function serve(env, fetchImpl = async () => { throw new Error("no network"); }) {
  const app = express();
  app.use("/api", createIceRouter({ env, fetchImpl, getUser: async (t) => (t === "good" ? { id: "u1" } : null) }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => server.close() };
}
const get = (base, token) => fetch(`${base}/api/calls/ice`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test("signed-out callers get 401", async () => {
  const s = await serve({});
  try { assert.equal((await get(s.base)).status, 401); assert.equal((await get(s.base, "bad")).status, 401); } finally { s.close(); }
});

test("no relay configured: STUN only", async () => {
  const s = await serve({});
  try {
    const d = await (await get(s.base, "good")).json();
    assert.deepEqual(d, { iceServers: STUN, relay: false });
  } finally { s.close(); }
});

test("static TURN credentials are added", async () => {
  const s = await serve({ TURN_URLS: "turn:a.example:3478, turns:a.example:443", TURN_USERNAME: "u", TURN_CREDENTIAL: "p" });
  try {
    const d = await (await get(s.base, "good")).json();
    assert.equal(d.relay, true);
    assert.deepEqual(d.iceServers.at(-1), { urls: ["turn:a.example:3478", "turns:a.example:443"], username: "u", credential: "p" });
  } finally { s.close(); }
});

test("Cloudflare TURN: a fresh 1-hour credential per request (never shared); falls back to STUN on errors", async () => {
  let calls = 0;
  const ok = async (url, init) => {
    calls++;
    assert.match(url, /\/turn\/keys\/k1\/credentials\/generate$/);
    assert.equal(init.headers.Authorization, "Bearer t1");
    assert.equal(JSON.parse(init.body).ttl, 3600);
    return { ok: true, json: async () => ({ iceServers: { urls: ["turn:turn.cloudflare.com:3478"], username: "x", credential: "y" } }) };
  };
  const s = await serve({ CF_TURN_KEY_ID: "k1", CF_TURN_API_TOKEN: "t1" }, ok);
  try {
    const d1 = await (await get(s.base, "good")).json();
    await get(s.base, "good");
    assert.equal(d1.relay, true);
    assert.equal(d1.iceServers.at(-1).username, "x");
    assert.equal(calls, 2, "each request gets its own credential");
  } finally { s.close(); }

  const s2 = await serve({ CF_TURN_KEY_ID: "k1", CF_TURN_API_TOKEN: "t1" }, async () => ({ ok: false, status: 500 }));
  try { assert.deepEqual(await (await get(s2.base, "good")).json(), { iceServers: STUN, relay: false }); } finally { s2.close(); }
});
