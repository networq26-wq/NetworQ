const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Load .env manually — no dotenv dependency needed
try {
  fs.readFileSync(path.join(__dirname, ".env"), "utf8")
    .split("\n")
    .forEach(line => {
      const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (m && !process.env[m[1].trim()]) {
        process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
      }
    });
} catch {}

// Serve waitlist.html with Supabase credentials injected from .env
app.get("/waitlist", (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, "public", "waitlist.html"), "utf8");
  const injected = html
    .replace("'REPLACE_WITH_YOUR_SUPABASE_URL'",      `'${process.env.EXPO_PUBLIC_SUPABASE_URL}'`)
    .replace("'REPLACE_WITH_YOUR_SUPABASE_ANON_KEY'", `'${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}'`);
  res.setHeader("Content-Type", "text/html");
  res.send(injected);
});

app.post("/api/claude", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
  }
  try {
    const payload = {
      ...req.body,
      model: "claude-haiku-4-5-20251001",
    };
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2025-01-21",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3001, () => console.log("✅ Proxy running on port 3001"));