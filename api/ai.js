const { createClient } = require("@supabase/supabase-js");
const { isAllowedOrigin } = require("./_lib/cors");
const { verifyAndCheckLimit } = require("./_lib/verifyAndLimit");
const { buildGroqRequestBody, FALLBACK_MODEL } = require("./_lib/groq");

module.exports = async function handler(req, res) {
  try {
    const origin = req.headers.origin;
    if (isAllowedOrigin(origin, process.env.ALLOWED_ORIGIN)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

    const authHeader = req.headers.authorization || req.headers.Authorization || "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const { action, system, messages, max_tokens } = req.body || {};

    // Every AI call must carry a valid session — the Groq key is billed per request
    if (!accessToken) return res.status(401).json({ error: "Missing Authorization token." });
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const supabase = supabaseUrl && supabaseAnonKey
      ? createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${accessToken}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
    if (!supabase && process.env.NODE_ENV === "production") {
      return res.status(500).json({ error: "Authentication is not configured on the server." });
    }
    if (supabase) {
      let check;
      try {
        check = await verifyAndCheckLimit(supabase, { accessToken, action });
      } catch (verifyErr) {
        console.warn("AI auth verification failed:", verifyErr.message);
        return res.status(503).json({ error: "Could not verify your session. Please try again." });
      }
      if (!check.ok) return res.status(check.status).json({ error: check.error });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "The AI assistant isn't available right now." });
    }

  try {
    const body = buildGroqRequestBody({ system, messages, max_tokens, action });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    let response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    let data = await response.json();

    // If initial model not found on current tier, fallback to versatile
    // Text-only fallback (the fallback model can't read images, so never for card scans)
    if (!response.ok && data?.error?.code === "model_not_found" && action !== "card_scan") {
      const fallbackBody = { ...body, model: FALLBACK_MODEL };
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(fallbackBody),
      });
      data = await response.json();
    }

    if (!response.ok) {
      throw new Error(data?.error?.message || `Groq API responded with status ${response.status}`);
    }

    res.status(response.status).json(data);
  } catch (e) {
    console.warn("Groq request warning:", e.message);
    // Never substitute canned or fabricated output for an AI answer: say it's unavailable instead
    const busy = /rate limit|tokens per minute|429|Request too large/i.test(e.message || "");
    return res.status(503).json({ error: busy ? "The AI is busy right now. Please try again in a minute." : "The AI assistant isn't available right now. Please try again." });

  }
  } catch (fatalErr) {
    console.error("AI Handler fatal exception:", fatalErr);
    return res.status(500).json({ error: fatalErr.message || "Internal AI Handler Error" });
  }
};

