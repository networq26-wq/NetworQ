const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createTtsRouter, splitForSpeech, cleanForSpeech } = require("../../api/tts");

test("text is cleaned for speech (markdown, links, acronyms)", () => {
  assert.equal(cleanForSpeech("**Hi** there — see https://x.co/abc for the CRM `notes`"), "Hi there — see the link for the C R M notes");
});

test("long text splits at sentence boundaries into chunks of at most 190 chars", () => {
  const text = "First sentence here. " + "This is a fairly long sentence that keeps going to test splitting. ".repeat(6) + "Last one!";
  const chunks = splitForSpeech(text, 190);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 190 && c.length > 0));
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), text.trim().replace(/\s+/g, " "));
});

function harness({ groqStatus = 200 } = {}) {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createTtsRouter({
      apiKey: "k",
      voice: "diana",
      getUser: async (t) => (t === "tok" ? { id: "u" } : null),
      fetchImpl: async (url, init) => {
        calls.push(JSON.parse(init.body));
        if (groqStatus !== 200) return new Response(JSON.stringify({ error: { message: "model requires terms acceptance", code: "model_terms_required" } }), { status: groqStatus });
        return new Response(Buffer.from("RIFFfakewav"), { status: 200, headers: { "content-type": "audio/wav" } });
      },
    })
  );
  const server = app.listen(0);
  const post = (body, token = "tok") =>
    fetch(`http://127.0.0.1:${server.address().port}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { calls, post, close: () => server.close() };
}

test("requires a session and non-empty text", async () => {
  const h = harness();
  try {
    assert.equal((await h.post({ text: "hi" }, null)).status, 401);
    assert.equal((await h.post({ text: "   " })).status, 400);
  } finally {
    h.close();
  }
});

test("synthesizes each chunk with the configured female voice and returns playable clips", async () => {
  const h = harness();
  try {
    const res = await h.post({ text: "Hello Asha. You have two follow-ups today." });
    assert.equal(res.status, 200);
    const { clips, voice } = await res.json();
    assert.equal(voice, "diana");
    assert.ok(clips.length >= 1 && clips.every((c) => c.startsWith("data:audio/wav;base64,")));
    assert.ok(h.calls.every((c) => c.model === "canopylabs/orpheus-v1-english" && c.voice === "diana" && c.response_format === "wav"));
  } finally {
    h.close();
  }
});

test("provider errors come back as 503 so the app can fall back to device speech", async () => {
  const h = harness({ groqStatus: 400 });
  try {
    const res = await h.post({ text: "Hello" });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /terms|unavailable/i);
  } finally {
    h.close();
  }
});

function elevenHarness({ elevenStatus = 200, groq = true } = {}) {
  const seen = [];
  const app = express();
  app.use(express.json());
  app.use("/api", createTtsRouter({
    apiKey: groq ? "k" : undefined,
    voice: "diana",
    elevenKey: "xi",
    elevenVoice: "voice123",
    getUser: async (t) => (t === "tok" ? { id: "u" } : null),
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      if (url.includes("elevenlabs")) return elevenStatus === 200 ? new Response(Buffer.from("ID3fakemp3"), { status: 200 }) : new Response("{}", { status: elevenStatus });
      return new Response(Buffer.from("RIFFfakewav"), { status: 200 });
    },
  }));
  const server = app.listen(0);
  const post = (body) => fetch(`http://127.0.0.1:${server.address().port}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer tok" }, body: JSON.stringify(body) });
  return { seen, post, close: () => server.close() };
}

test("ElevenLabs is used first when configured (natural voice, one mp3 clip)", async () => {
  const h = elevenHarness();
  try {
    const d = await (await h.post({ text: "Hello there. This is NetworQ." })).json();
    assert.equal(d.voice, "elevenlabs");
    assert.equal(d.clips.length, 1);
    assert.match(d.clips[0], /^data:audio\/mpeg;base64,/);
    assert.match(h.seen[0].url, /api\.elevenlabs\.io\/v1\/text-to-speech\/voice123/);
    assert.equal(h.seen[0].init.headers["xi-api-key"], "xi");
  } finally { h.close(); }
});

test("if ElevenLabs fails, the Groq voice takes over; with no fallback it's an honest 503", async () => {
  const h = elevenHarness({ elevenStatus: 401 });
  try {
    const d = await (await h.post({ text: "Hello." })).json();
    assert.equal(d.voice, "diana");
  } finally { h.close(); }
  const h2 = elevenHarness({ elevenStatus: 500, groq: false });
  try { assert.equal((await h2.post({ text: "Hello." })).status, 503); } finally { h2.close(); }
});
