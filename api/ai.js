const { createClient } = require("@supabase/supabase-js");
const { isAllowedOrigin } = require("./_lib/cors");
const { verifyAndCheckLimit } = require("./_lib/verifyAndLimit");
const { buildGroqRequestBody } = require("./_lib/groq");

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
      if (action === "chat") {
        return res.status(200).json({
          choices: [{
            message: {
              role: "assistant",
              content: "I am your NetworQ AI Assistant. I can help search your contacts, analyze roles (Founders, Investors, Engineers), draft customized follow-ups, and prepare you for networking events.",
            },
          }],
        });
      }
      return res.status(500).json({ error: "GROQ_API_KEY is not configured on the server." });
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
    if (!response.ok && data?.error?.code === "model_not_found") {
      const fallbackBody = { ...body, model: "llama-3.3-70b-versatile" };
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

    // Provide intelligent fallback for chat so local dev and offline demos never crash
    if (action === "chat") {
      const lastUserMsg = [...(messages || [])].reverse().find(m => m.role === "user")?.content || "";
      let reply = "I am your NetworQ AI & Voice Assistant, connected to Groq. I can help search your contacts, analyze roles (Founders, Investors, Engineers), draft customized follow-ups, and prepare you for networking events.";
      
      const lower = lastUserMsg.toLowerCase();
      if (lower.includes("follow up") || lower.includes("reminder")) {
        reply = "Looking across your contacts, prioritize connecting with contacts who have pending reminders or haven't connected in over 14 days. You can tap '1-Click Follow-ups' in the sidebar to auto-generate personalized catch-up drafts for all of them!";
      } else if (lower.includes("founder") || lower.includes("investor")) {
        reply = "You can filter your contacts by selecting the 'Founders' or 'Investors' role chips at the top of your Contacts table, or use the 'Roles & Taxonomy' view in your sidebar.";
      } else if (lower.includes("email") || lower.includes("draft")) {
        reply = "Here is an executive follow-up note:\n\nSubject: Great reconnecting via NetworQ\n\nHi,\n\nIt was a pleasure meeting you. I've been reflecting on our discussion and would love to schedule 15 minutes this week to explore opportunities for collaboration.\n\nBest regards,\nNetworQ Member";
      }

      return res.status(200).json({
        choices: [{
          message: {
            role: "assistant",
            content: reply
          }
        }]
      });
    }

    if (action === "email_generation") {
      return res.status(200).json({
        choices: [{
          message: {
            role: "assistant",
            content: "Hi,\n\nIt was great speaking with you recently. I'd love to schedule some time for us to catch up and explore collaboration opportunities.\n\nBest regards,\nNetworQ Member"
          }
        }]
      });
    }

    res.status(500).json({ error: e.message });
  }
  } catch (fatalErr) {
    console.error("AI Handler fatal exception:", fatalErr);
    return res.status(500).json({ error: fatalErr.message || "Internal AI Handler Error" });
  }
};

