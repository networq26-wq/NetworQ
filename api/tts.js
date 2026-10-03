/**
 * Natural speech for the AI assistant: Groq-hosted Orpheus (female voice by default).
 * Returns an ordered list of short WAV clips; the app plays them back-to-back and
 * falls back to on-device speech when this endpoint is unavailable (503).
 */
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const MODEL = "canopylabs/orpheus-v1-english";
const MAX_INPUT = 1200;
const CHUNK = 190;

function cleanForSpeech(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/[*_#`~>|[\]]/g, "")
    .replace(/•/g, ",")
    .replace(/\bCRM\b/g, "C R M")
    .replace(/\s+/g, " ")
    .trim();
}

function splitForSpeech(text, max = CHUNK) {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const chunks = [];
  let cur = "";
  const push = () => cur.trim() && chunks.push(cur.trim());
  for (const s of sentences) {
    if ((cur + s).trim().length <= max) {
      cur += s;
      continue;
    }
    push();
    cur = "";
    if (s.trim().length <= max) {
      cur = s;
      continue;
    }
    // very long sentence: break on words
    let part = "";
    for (const w of s.trim().split(/\s+/)) {
      if ((part + " " + w).trim().length > max) {
        chunks.push(part.trim());
        part = w;
      } else part = (part + " " + w).trim();
    }
    cur = part + " ";
  }
  push();
  return chunks;
}

function createTtsRouter(deps) {
  const router = express.Router();
  router.post("/tts", async (req, res) => {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const user = token ? await deps.getUser(token).catch(() => null) : null;
    if (!user) return res.status(401).json({ error: "Please sign in again." });

    const text = cleanForSpeech(req.body?.text).slice(0, MAX_INPUT);
    if (!text) return res.status(400).json({ error: "Nothing to say." });
    if (!deps.apiKey) return res.status(503).json({ error: "Voice is unavailable on this server." });

    try {
      const clips = [];
      for (const input of splitForSpeech(text)) {
        const r = await deps.fetchImpl("https://api.groq.com/openai/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: MODEL, voice: deps.voice, input, response_format: "wav" }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.error?.message || `voice provider error ${r.status}`);
        }
        clips.push(`data:audio/wav;base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`);
      }
      res.json({ voice: deps.voice, clips });
    } catch (err) {
      console.warn("[TTS]", err.message);
      res.status(503).json({ error: `Natural voice unavailable (${err.message}).` });
    }
  });
  return router;
}

function productionDeps() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    apiKey: process.env.GROQ_API_KEY,
    voice: process.env.TTS_VOICE || "diana",
    fetchImpl: fetch,
    async getUser(token) {
      const { data, error } = await client.auth.getUser(token);
      return error ? null : data.user;
    },
  };
}

module.exports = { createTtsRouter, productionDeps, splitForSpeech, cleanForSpeech };
