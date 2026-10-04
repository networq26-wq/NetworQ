const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createTranscribeRouter, MODEL } = require("../../api/transcribe");

function serve({ apiKey = "gsk_test", reply = { status: 200, json: { text: "Met Priya from Zoho, follow up Thursday." } }, limited = false } = {}) {
  const seen = [];
  const app = express();
  app.use(express.json());
  app.use("/api", createTranscribeRouter({
    apiKey,
    getUser: async (t) => (t === "good" ? { id: "u1" } : null),
    checkLimit: async () => (limited ? { ok: false, error: "You've used today's 60 voice notes." } : { ok: true }),
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return { ok: reply.status < 400, status: reply.status, json: async () => reply.json };
    },
  }));
  const server = app.listen(0);
  const post = (body, { token = "good", type = "audio/webm;codecs=opus", q = "" } = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/transcribe${q}`, { method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": type }, body });
  return { post, seen, close: () => server.close() };
}
const audio = (n = 4000) => Buffer.alloc(n, 7);

test("signed-out requests are refused", async () => {
  const s = serve();
  try { assert.equal((await s.post(audio(), { token: "" })).status, 401); assert.equal(s.seen.length, 0); } finally { s.close(); }
});

test("transcribes a recording with Whisper", async () => {
  const s = serve();
  try {
    const r = await s.post(audio(), { q: "?lang=en" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { text: "Met Priya from Zoho, follow up Thursday." });
    assert.equal(s.seen[0].url, "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(s.seen[0].init.headers.Authorization, "Bearer gsk_test");
    const form = s.seen[0].init.body;
    assert.equal(form.get("model"), MODEL);
    assert.equal(form.get("language"), "en");
    assert.equal(form.get("file").name, "speech.webm");
  } finally { s.close(); }
});

test("rejects non-audio, too-short and silent recordings with plain messages", async () => {
  const s = serve({ reply: { status: 200, json: { text: " Thank you. " } } });
  try {
    assert.equal((await s.post(audio(), { type: "text/plain" })).status, 415);
    assert.equal((await s.post(audio(100))).status, 400);
    const silent = await s.post(audio());
    assert.equal(silent.status, 422);
    assert.match((await silent.json()).error, /couldn't hear any words/);
  } finally { s.close(); }
});

test("provider busy / down / no key → friendly errors", async () => {
  const busy = serve({ reply: { status: 429, json: {} } });
  try { assert.equal((await busy.post(audio())).status, 503); } finally { busy.close(); }
  const down = serve({ reply: { status: 500, json: {} } });
  try { assert.equal((await down.post(audio())).status, 502); } finally { down.close(); }
  const nokey = serve({ apiKey: "" });
  try { assert.equal((await nokey.post(audio())).status, 503); } finally { nokey.close(); }
});

test("daily cap: over the limit gets a plain 429 and nothing is sent to the provider", async () => {
  const s = serve({ limited: true });
  try {
    const r = await s.post(audio());
    assert.equal(r.status, 429);
    assert.match((await r.json()).error, /today's 60 voice notes/);
    assert.equal(s.seen.length, 0);
  } finally { s.close(); }
});
