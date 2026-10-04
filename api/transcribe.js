/**
 * Speech → text for voice notes and the AI assistant's mic. The app records audio
 * (MediaRecorder — works in the Android app's WebView, unlike browser speech recognition)
 * and posts it here; Groq-hosted Whisper transcribes it (handles Indian English and Hindi).
 */
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const MODEL = "whisper-large-v3-turbo";
const MAX_BYTES = 8 * 1024 * 1024; // ~4 min of compressed speech
const TYPES = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|m4a|x-m4a|aac)(;.*)?$/i;
const EXT = { webm: "webm", ogg: "ogg", mp4: "m4a", mpeg: "mp3", mp3: "mp3", wav: "wav", "x-wav": "wav", m4a: "m4a", "x-m4a": "m4a", aac: "m4a" };

function createTranscribeRouter(deps) {
  const router = express.Router();
  router.post("/transcribe", express.raw({ type: () => true, limit: MAX_BYTES }), async (req, res) => {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const user = token ? await deps.getUser(token).catch(() => null) : null;
    if (!user) return res.status(401).json({ error: "Please sign in again." });
    if (!deps.apiKey) return res.status(503).json({ error: "Voice typing isn't available right now. Please type instead." });

    const type = String(req.headers["content-type"] || "");
    if (!TYPES.test(type)) return res.status(415).json({ error: "Unsupported audio format." });
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length < 1200) return res.status(400).json({ error: "We didn't catch anything. Hold the button a little longer and speak." });

    const sub = type.split(";")[0].split("/")[1].toLowerCase();
    const form = new FormData();
    form.append("file", new Blob([body], { type: type.split(";")[0] }), `speech.${EXT[sub] || "webm"}`);
    form.append("model", MODEL);
    form.append("response_format", "json");
    form.append("temperature", "0");
    if (req.query.lang && /^[a-z]{2}$/.test(String(req.query.lang))) form.append("language", String(req.query.lang));

    try {
      const r = await deps.fetchImpl("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${deps.apiKey}` },
        body: form,
      });
      if (r.status === 429) return res.status(503).json({ error: "Voice typing is busy right now. Please try again in a minute." });
      if (!r.ok) {
        console.warn("[transcribe] provider error", r.status);
        return res.status(502).json({ error: "Couldn't turn that into text. Please try again." });
      }
      const d = await r.json();
      const text = String(d.text || "").trim();
      // Whisper sometimes returns these for silence
      if (!text || /^(thank you\.?|thanks for watching!?|you)$/i.test(text)) return res.status(422).json({ error: "We couldn't hear any words. Move closer to the mic and try again." });
      return res.json({ text });
    } catch (e) {
      console.warn("[transcribe] failed", e.message);
      return res.status(502).json({ error: "Couldn't turn that into text. Please try again." });
    }
  });
  // Oversized uploads
  router.use((err, req, res, next) => {
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "That recording is too long. Keep voice notes under 4 minutes." });
    next(err);
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
    fetchImpl: fetch,
    async getUser(token) {
      const { data, error } = await client.auth.getUser(token);
      return error ? null : data.user;
    },
  };
}

module.exports = { createTranscribeRouter, productionDeps, MODEL };
