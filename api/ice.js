// WebRTC ICE servers for calls. STUN always; a TURN relay when configured, so calls also
// connect on strict mobile / office networks. Signed-in users only (relay credentials cost money).
//   Option A (Cloudflare Calls TURN, free tier): CF_TURN_KEY_ID + CF_TURN_API_TOKEN
//   Option B (any TURN provider, e.g. Metered): TURN_URLS (comma-separated) + TURN_USERNAME + TURN_CREDENTIAL
const express = require("express");

const STUN = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

function createIceRouter(deps) {
  const router = express.Router();
  let cache = null; // { servers, until }

  router.get("/calls/ice", async (req, res) => {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const user = token ? await deps.getUser(token).catch(() => null) : null;
    if (!user) return res.status(401).json({ error: "Please sign in again." });
    res.set("Cache-Control", "no-store");

    const env = deps.env;
    try {
      if (env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN) {
        if (!cache || cache.until < Date.now()) {
          const r = await deps.fetchImpl(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CF_TURN_KEY_ID)}/credentials/generate`, {
            method: "POST",
            headers: { Authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ttl: 6 * 3600 }),
          });
          if (!r.ok) throw new Error(`turn ${r.status}`);
          const d = await r.json();
          const servers = Array.isArray(d.iceServers) ? d.iceServers : d.iceServers ? [d.iceServers] : [];
          cache = { servers, until: Date.now() + 5 * 3600 * 1000 };
        }
        return res.json({ iceServers: [...STUN, ...cache.servers], relay: true });
      }
      if (env.TURN_URLS && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
        const urls = env.TURN_URLS.split(",").map((u) => u.trim()).filter(Boolean);
        return res.json({ iceServers: [...STUN, { urls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }], relay: true });
      }
    } catch (e) {
      console.warn("[ice] relay unavailable, falling back to STUN:", e.message);
    }
    return res.json({ iceServers: STUN, relay: false });
  });
  return router;
}

function productionDeps() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const { createClient } = require("@supabase/supabase-js");
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    env: process.env,
    fetchImpl: (...a) => fetch(...a),
    async getUser(token) {
      const { data, error } = await client.auth.getUser(token);
      return error ? null : data.user;
    },
  };
}

module.exports = { createIceRouter, productionDeps, STUN };
