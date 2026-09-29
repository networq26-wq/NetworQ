const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const aiHandler = require("./api/ai");
const waitlistHandler = require("./api/waitlist");
const enrichHandler = require("./api/enrich");
const emailHandler = require("./api/email");
const { startReminderEngine } = require("./api/reminders");
const { isAllowedOrigin } = require("./api/_lib/cors");

const app = express();

function parseEnvContent(content) {
  if (!content) return;
  content.split("\n").forEach((line) => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m && m[1]) {
      const key = m[1].trim();
      const val = m[2].trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[key] || process.env[key] === "") {
        process.env[key] = val;
      }
    }
  });
}

// 1. Read from local or root .env
try {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    parseEnvContent(fs.readFileSync(envPath, "utf8"));
  }
} catch (err) {
  console.warn("Could not read local .env file:", err.message);
}

// 2. Read from Render's /etc/secrets/ directory (Render Secret Files mount location)
try {
  const secretDir = "/etc/secrets";
  if (fs.existsSync(secretDir)) {
    fs.readdirSync(secretDir).forEach((file) => {
      try {
        const filePath = path.join(secretDir, file);
        if (fs.statSync(filePath).isFile()) {
          parseEnvContent(fs.readFileSync(filePath, "utf8"));
        }
      } catch (e) {}
    });
  }
} catch (err) {}

// 3. Parse if provided as a multi-line string variable in Render dashboard (e.g. Env-files)
Object.keys(process.env).forEach((k) => {
  if (k.toLowerCase().includes("env-file") || k.toLowerCase().includes("env_file") || k.toLowerCase().includes("envfiles")) {
    parseEnvContent(process.env[k]);
  }
});

const defaultOrigins =
  "http://localhost:8081,http://localhost:19006,http://localhost:8082,http://localhost:3000,http://localhost:3001,http://127.0.0.1:8081,http://127.0.0.1:3000,http://127.0.0.1:3001,http://localhost,http://127.0.0.1,https://networq-app.surge.sh,https://www.networq.co.in,https://networq.co.in,https://networq-epf0.onrender.com";

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Always allow local development origins (localhost, 127.0.0.1, [::1])
      if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }

      // Always allow production custom domains
      if (
        origin === "https://www.networq.co.in" ||
        origin === "https://networq.co.in" ||
        origin === "https://networq-epf0.onrender.com" ||
        origin === "https://networq-app.surge.sh"
      ) {
        return callback(null, true);
      }

      // Allow any *.onrender.com, *.railway.app
      if (/\.onrender\.com$/.test(origin) || /\.railway\.app$/.test(origin)) {
        return callback(null, true);
      }

      // Allow configured origins from .env
      if (isAllowedOrigin(origin, process.env.ALLOWED_ORIGIN || defaultOrigins)) {
        return callback(null, true);
      }

      // Fallback: don't throw an unhandled 500 error, just disallow origin
      return callback(null, false);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "NetworQ",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    services: {
      ai: !!process.env.GROQ_API_KEY,
      email: !!(process.env.RESEND_API_KEY || process.env.GMAIL_USER || process.env.SMTP_HOST),
      reminders: true,
      supabase: !!process.env.EXPO_PUBLIC_SUPABASE_URL,
    },
  });
});

// ── Waitlist ──────────────────────────────────────────────────────────────────
app.get("/waitlist", (req, res) => waitlistHandler(req, res));

// ── Company enrichment ────────────────────────────────────────────────────────
app.all("/api/enrich", async (req, res) => enrichHandler(req, res));

// ── AI routes ─────────────────────────────────────────────────────────────────
app.post("/api/ai", async (req, res) => aiHandler(req, res));
app.post("/api/groq", async (req, res) => aiHandler(req, res));
app.post("/api/claude", async (req, res) => aiHandler(req, res)); // backward compat
app.get("/api/groq", (req, res) => {
  res.json({
    status: "ok",
    provider: "groq",
    models: { text: "qwen/qwen3.8-27b", vision: "meta-llama/llama-4-scout-17b-16e-instruct" },
    timestamp: new Date().toISOString(),
  });
});

// ── Email sending ─────────────────────────────────────────────────────────────
app.post("/api/email", async (req, res) => emailHandler(req, res));
app.options("/api/email", (req, res) => res.status(200).end());

// ── Serve web frontend build if dist directory exists ─────────────────────────
const distPath = path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
  app.get("/waitlist.html", (req, res) => waitlistHandler(req, res));
  app.use(express.static(distPath));
  app.use((req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// ── Multi-port listener for seamless local development ────────────────────────
const primaryPort = parseInt(process.env.PORT || "3001", 10);
const targetPorts = [primaryPort, 3000, 8081].filter(
  (p, idx, arr) => arr.indexOf(p) === idx
);

targetPorts.forEach((port) => {
  try {
    const srv = app.listen(port, "0.0.0.0", () => {
      console.log(
        `✅ NetworQ server live on http://localhost:${port} & http://127.0.0.1:${port}`
      );
    });
    srv.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log(`ℹ️  Port ${port} is in use by another process; skipping.`);
      } else {
        console.warn(`Server on port ${port} notice:`, err.message);
      }
    });
  } catch (err) {
    // Ignore secondary binding errors
  }
});

// ── Start background reminder engine ──────────────────────────────────────────
// Only run on primary instance (not during Expo web build)
if (process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  startReminderEngine();
}