const express = require("express");
const compression = require("compression");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const aiHandler = require("./api/ai");
const waitlistHandler = require("./api/waitlist");
const enrichHandler = require("./api/enrich");
const emailHandler = require("./api/email");
const { startReminderEngine } = require("./api/reminders");
const { createAccountRouter, productionDeps, purgeDeletedAccounts } = require("./api/account");
const { createEventsRouter, productionDeps: eventsDeps } = require("./api/events");
const { startEventsCrawler } = require("./api/eventsCrawler");
const { createTtsRouter, productionDeps: ttsDeps } = require("./api/tts");
const { createNotifyHookRouter, productionDeps: notifyDeps } = require("./api/notifyHook");
const { createProspectRouter, productionDeps: prospectDeps } = require("./api/prospect");
const { createIceRouter, productionDeps: iceDeps, STUN } = require("./api/ice");
const { createClient: createSupabaseClient } = require("@supabase/supabase-js");
const { isAllowedOrigin } = require("./api/_lib/cors");

const app = express();
app.set("trust proxy", 1); // Render / Fly / Railway sit behind one proxy hop — needed for per-IP limits
app.disable("x-powered-by");
app.use(compression());

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // set per-route below (the waitlist page needs inline scripts)
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }, // Google sign-in popup
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob: https://*.supabase.co wss://*.supabase.co https://www.googleapis.com https://accounts.google.com https://www.networq.co.in",
  "frame-src https://accounts.google.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/") && !req.path.startsWith("/waitlist")) {
    res.setHeader("Content-Security-Policy", APP_CSP);
  }
  next();
});

// ── Rate limits (per IP; per-user daily caps live in increment_ai_usage) ──────
const limiter = (windowMs, limit) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down and try again shortly." },
  });
app.use("/api/", limiter(15 * 60 * 1000, 600));
app.use("/api/enrich", limiter(60 * 1000, 30));
app.use(["/api/ai", "/api/groq", "/api/claude"], limiter(60 * 1000, 60));
app.use("/api/email", limiter(60 * 1000, 20));
app.use(["/api/auth", "/api/account"], limiter(60 * 1000, 30));
app.use("/api/events", limiter(60 * 1000, 20));
app.use("/api/tts", limiter(60 * 1000, 30));
app.use(["/api/prospect", "/api/organization"], limiter(60 * 1000, 20));

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

// 1. Read from local or root .env (tests set NETWORQ_SKIP_DOTENV to stay hermetic)
try {
  const envPath = path.join(__dirname, ".env");
  if (!process.env.NETWORQ_SKIP_DOTENV && fs.existsSync(envPath)) {
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

// ── App Version & Direct APK Download ─────────────────────────────────────────
app.get("/api/version", (req, res) => {
  res.json({
    appName: "NetworQ",
    version: "1.0.0",
    versionCode: 1,
    downloadUrl: "https://www.networq.co.in/download/NetworQ.apk",
    otaChannel: "production",
    updatedAt: new Date().toISOString(),
  });
});

app.get(["/download/apk", "/download/NetworQ.apk", "/api/download/apk"], (req, res) => {
  const apkPath = path.join(__dirname, "public/download/NetworQ.apk");
  if (fs.existsSync(apkPath)) {
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", 'attachment; filename="NetworQ.apk"');
    return res.sendFile(apkPath);
  }
  const distApkPath = path.join(__dirname, "dist/download/NetworQ.apk");
  if (fs.existsSync(distApkPath)) {
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", 'attachment; filename="NetworQ.apk"');
    return res.sendFile(distApkPath);
  }
  return res.status(404).json({ error: "NetworQ APK is currently building or not found." });
});

// ── Legal pages (Play Store requires public privacy policy + deletion info) ─────
const legalDir = path.join(__dirname, "public/legal");
app.use("/legal", express.static(legalDir, { maxAge: "1d" }));
app.get("/privacy", (req, res) => res.sendFile(path.join(legalDir, "privacy.html")));
app.get("/terms", (req, res) => res.sendFile(path.join(legalDir, "terms.html")));
app.get("/delete-account", (req, res) => res.sendFile(path.join(legalDir, "delete-account.html")));
app.get("/bot", (req, res) => res.sendFile(path.join(legalDir, "bot.html")));

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
    models: { text: "llama-3.3-70b-versatile", vision: "llama-3.2-11b-vision-preview" },
    timestamp: new Date().toISOString(),
  });
});

// ── Account security: sign-in alerts, secure-my-account, deletion ─────────────
const accountDeps = productionDeps();
if (accountDeps) {
  app.use("/api", createAccountRouter(accountDeps));
} else {
  app.all(["/api/auth/*splat", "/api/account/*splat"], (req, res) =>
    res.status(503).json({ error: "Account service is not configured on this server." })
  );
}

// ── Events import (real event pages / .ics feeds only) ────────────────────────
const evDeps = eventsDeps();
if (evDeps) app.use("/api", createEventsRouter(evDeps));
else app.all("/api/events/*splat", (req, res) => res.status(503).json({ error: "Events service is not configured on this server." }));

// ── Call relay settings (STUN always; TURN when configured) ────────────────────
const iceDepsValue = iceDeps();
if (iceDepsValue) app.use("/api", createIceRouter(iceDepsValue));
else app.get("/api/calls/ice", (req, res) => res.json({ iceServers: STUN, relay: false }));

// ── Dev-only Bluetooth simulator for the device preview (never in production) ──
// Preview windows publish their current Radar token here and "hear" each other,
// so the full token → resolve → connect flow can be tested without radios.
if (process.env.NODE_ENV !== "production") {
  const air = new Map(); // deviceId → { token, rssi, at }
  app.post("/api/dev/ble", (req, res) => {
    const { deviceId, token, rssi } = req.body || {};
    if (typeof deviceId !== "string" || deviceId.length > 64) return res.status(400).json({ error: "deviceId required" });
    if (token && /^[0-9a-f]{16}$/.test(token)) air.set(deviceId, { token, rssi: Number(rssi) || -75, at: Date.now() });
    else air.delete(deviceId);
    const heard = [...air.entries()]
      .filter(([id, v]) => id !== deviceId && Date.now() - v.at < 10_000)
      .map(([, v]) => ({ token: v.token, rssi: v.rssi + Math.round((Math.random() - 0.5) * 6), ts: Date.now() }));
    res.json({ heard });
  });
}

// ── Database → server hook: connection emails ────────────────────────────────
const notifyD = notifyDeps();
if (notifyD) app.use("/api", createNotifyHookRouter(notifyD));

// ── Natural voice for the AI assistant ───────────────────────────────────────
const ttsD = ttsDeps();
if (ttsD) app.use("/api", createTtsRouter(ttsD));
else app.post("/api/tts", (req, res) => res.status(503).json({ error: "Voice is unavailable on this server." }));

// ── AI prospect research + email drafting ───────────────────────────────────
const prospectD = prospectDeps();
if (prospectD) app.use("/api", createProspectRouter(prospectD));
else app.post(["/api/prospect/*splat", "/api/organization/*splat"], (req, res) => res.status(503).json({ error: "AI research is unavailable on this server." }));

// ── Push: public VAPID key for browsers (the private key never leaves the server) ──
app.get("/api/push/config", (req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.json({ vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// ── Email sending ─────────────────────────────────────────────────────────────
app.post("/api/email", async (req, res) => emailHandler(req, res));
app.options("/api/email", (req, res) => res.status(200).end());

// ── Serve web frontend build if dist directory exists ─────────────────────────
const distPath = path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
  app.get(["/waitlist", "/waitlist.html"], (req, res) => waitlistHandler(req, res));

  // Serve waitlist at root if on waitlist subdomain or if WAITLIST_MODE is set
  app.use((req, res, next) => {
    const host = req.headers.host || "";
    if (host.startsWith("waitlist.") || process.env.WAITLIST_MODE === "true" || process.env.SERVE_WAITLIST_AT_ROOT === "true") {
      if (req.path === "/" || req.path === "/index.html") {
        return waitlistHandler(req, res);
      }
    }
    next();
  });

  // Serve static assets with high-performance caching (1 year for immutable hashed bundles)
  app.use(
    express.static(distPath, {
      maxAge: "30d",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) {
          // Always revalidate index.html so code updates are immediate
          res.setHeader("Cache-Control", "no-cache, must-revalidate");
        } else if (filePath.includes("/_expo/static/") || filePath.includes("/static/js/")) {
          // Content-hashed bundles never change
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.endsWith(".apk")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: `API endpoint ${req.method} ${req.path} not found.` });
    }
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// ── Global API JSON Error Handler ─────────────────────────────────────────────
app.use("/api", (err, req, res, next) => {
  console.error("API Server Error:", err);
  if (!res.headersSent) {
    const status = err.status || err.statusCode || 500;
    // Never leak internals to clients in production
    const message = status < 500 || process.env.NODE_ENV !== "production" ? err.message : "Internal server error";
    res.status(status).json({ error: message || "Internal API Error" });
  }
});

// ── Multi-port listener for seamless local development ────────────────────────
// Production binds only $PORT; local dev also tries the legacy 3000/8081 ports.
function startServer() {
  const primaryPort = parseInt(process.env.PORT || "3001", 10);
  const targetPorts =
    process.env.NODE_ENV === "production" || process.env.NETWORQ_SINGLE_PORT
      ? [primaryPort]
      : [primaryPort, 3000, 8081].filter((p, idx, arr) => arr.indexOf(p) === idx);

  const servers = [];
  targetPorts.forEach((port) => {
    try {
      const srv = app.listen(port, "0.0.0.0", () => {
        console.log(
          `✅ NetworQ server live on http://localhost:${port} & http://127.0.0.1:${port}`
        );
      });
      servers.push(srv);
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

  // ── Start background reminder engine ────────────────────────────────────────
  // Only run on primary instance (not during Expo web build)
  let reminderTimer = null;
  let purgeTimer = null;
  let stopCrawler = null;
  // Background jobs touch real users (reminder emails, deletions, crawling) — production only,
  // unless explicitly enabled for local debugging with NETWORQ_JOBS=1.
  const runJobs = process.env.NODE_ENV === "production" || process.env.NETWORQ_JOBS === "1";
  if (runJobs && process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    reminderTimer = startReminderEngine();
    purgeDeletedAccounts().catch(console.error);
    purgeTimer = setInterval(() => purgeDeletedAccounts().catch(console.error), 60 * 60 * 1000);
    if (process.env.EVENTS_CRAWLER !== "off") {
      const admin = createSupabaseClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      stopCrawler = startEventsCrawler(admin);
    }
  }

  // ── Graceful shutdown: finish in-flight requests on deploy/restart ──────────
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received — shutting down gracefully`);
    if (reminderTimer) clearInterval(reminderTimer);
    if (purgeTimer) clearInterval(purgeTimer);
    if (stopCrawler) stopCrawler();
    let open = servers.length;
    if (!open) process.exit(0);
    servers.forEach((srv) =>
      srv.close(() => {
        open -= 1;
        if (open === 0) process.exit(0);
      })
    );
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (require.main === module) {
  startServer();
}

module.exports = app;
