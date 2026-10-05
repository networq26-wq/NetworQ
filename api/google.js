/**
 * Google Calendar + Meet for every user, on web AND in the Android app.
 *
 * Each user connects once (Google's consent page in the phone's browser — Google blocks sign-in inside
 * app WebViews). We keep their refresh token encrypted on the server, and create Calendar events with
 * Google Meet links from here, so no pop-ups are needed afterwards and it works everywhere.
 *
 * Env: GOOGLE_CLIENT_ID (or EXPO_PUBLIC_GOOGLE_CLIENT_ID), GOOGLE_CLIENT_SECRET, LINK_SIGNING_SECRET, PUBLIC_APP_URL.
 * Google Cloud → Clients → Web client → Authorised redirect URI: <PUBLIC_APP_URL>/api/google/callback
 */
const express = require("express");
const crypto = require("crypto");

const SCOPE = "https://www.googleapis.com/auth/calendar.events openid email";

function keyFrom(secret) {
  return crypto.createHash("sha256").update(`networq-google:${secret}`).digest();
}
function encrypt(secret, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}
function decrypt(secret, blob) {
  const [v, iv, tag, enc] = String(blob).split(".");
  if (v !== "v1") throw new Error("bad token format");
  const d = crypto.createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}
// Signed, short-lived state so a callback can only be for the user who started it
function signState(secret, data) {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + 10 * 60 * 1000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function readState(secret, state) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return data.exp > Date.now() ? data : null;
}

const page = (title, body, cta) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;font-family:-apple-system,system-ui,Roboto,sans-serif;background:#F5F5F7;color:#1C1C1E;display:flex;min-height:100vh;align-items:center;justify-content:center}
.c{background:#fff;border-radius:24px;padding:36px 28px;max-width:380px;margin:24px;text-align:center;box-shadow:0 10px 30px rgba(40,20,90,.12)}
h1{font-size:22px;margin:16px 0 8px}p{color:#6E6E73;font-size:16px;line-height:1.45;margin:0 0 22px}
a{display:block;background:#7C3AED;color:#fff;text-decoration:none;font-weight:600;font-size:17px;padding:15px;border-radius:16px}</style></head>
<body><div class="c"><img src="/brand/networq-wordmark.png" alt="NetworQ" height="28"><h1>${title}</h1><p>${body}</p>${cta}</div></body></html>`;

function createGoogleRouter(deps) {
  const router = express.Router();
  const ready = () => deps.clientId && deps.clientSecret && deps.secret;
  const redirectUri = () => `${deps.appUrl.replace(/\/$/, "")}/api/google/callback`;

  async function userFrom(req) {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    return token ? deps.getUser(token).catch(() => null) : null;
  }

  async function accessTokenFor(userId) {
    const row = await deps.loadLink(userId);
    if (!row) return null;
    const refresh = decrypt(deps.secret, row.refresh_token_enc);
    const r = await deps.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: deps.clientId, client_secret: deps.clientSecret, refresh_token: refresh, grant_type: "refresh_token" }).toString(),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) {
      if (d.error === "invalid_grant") await deps.deleteLink(userId); // revoked by the user at Google
      return null;
    }
    return d.access_token;
  }

  // Sign in with Google on NetworQ's own domain (Google shows "continue to networq.co.in", not Supabase).
  // The callback hands Google's ID token to the app, which signs in to Supabase with signInWithIdToken.
  router.get("/google/available", (req, res) => res.json({ available: !!ready() }));
  router.get("/google/signin", (req, res) => {
    const from = req.query.from === "app" ? "app" : "web";
    // Not configured here: tell the app to use its older Supabase sign-in instead
    if (!ready()) return res.redirect(302, from === "app" ? "networq://auth-callback?fallback=1" : "/?google=unavailable");
    const q = new URLSearchParams({
      client_id: deps.clientId,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
      state: signState(deps.secret, { purpose: "signin", from }),
    });
    res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`);
  });

  // 1. Where to send the user to connect (the app opens it in the phone's browser)
  router.post("/google/connect", async (req, res) => {
    const user = await userFrom(req);
    if (!user) return res.status(401).json({ error: "Please sign in again." });
    if (!ready()) return res.status(503).json({ error: "Google Calendar isn't set up on this server yet." });
    const from = req.body?.from === "app" ? "app" : "web";
    const q = new URLSearchParams({
      client_id: deps.clientId,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: signState(deps.secret, { uid: user.id, from }),
      ...(user.email ? { login_hint: user.email } : {}),
    });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}` });
  });

  // 2. Google sends the user back here
  router.get("/google/callback", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const st = ready() ? readState(deps.secret, req.query.state) : null;
    const back = st?.from === "app" ? `<a href="networq://google-connected">Back to NetworQ</a>` : `<a href="/?open=settings&google=connected">Back to NetworQ</a>`;
    if (!st) return res.status(400).send(page("That link expired", "Please start again from NetworQ: Me → Connect Google Calendar.", `<a href="/">Open NetworQ</a>`));
    if (st.purpose === "signin") {
      const fail = (msg) => (st.from === "app" ? res.redirect(302, `networq://auth-callback?error=${encodeURIComponent(msg)}`) : res.redirect(302, `/#google_error=${encodeURIComponent(msg)}`));
      if (req.query.error) return fail("Google sign-in was cancelled.");
      try {
        const r = await deps.fetchImpl("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ code: String(req.query.code || ""), client_id: deps.clientId, client_secret: deps.clientSecret, redirect_uri: redirectUri(), grant_type: "authorization_code" }).toString(),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.id_token) throw new Error(d.error_description || d.error || "no id token");
        // Fragment (web) / app link: the token never reaches any server log
        return st.from === "app" ? res.redirect(302, `networq://auth-callback?id_token=${encodeURIComponent(d.id_token)}`) : res.redirect(302, `/#google_id_token=${encodeURIComponent(d.id_token)}`);
      } catch (e) {
        console.warn("[google] sign-in failed:", e.message);
        return fail("Google sign-in didn't finish. Please try again.");
      }
    }
    if (req.query.error) return res.status(200).send(page("Not connected", "You didn't allow calendar access, so Google Meet isn't connected. You can still use Free room or Paste link.", back));
    try {
      const r = await deps.fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: String(req.query.code || ""), client_id: deps.clientId, client_secret: deps.clientSecret, redirect_uri: redirectUri(), grant_type: "authorization_code" }).toString(),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.refresh_token) throw new Error(d.error_description || d.error || "no refresh token");
      if (!String(d.scope || "").includes("calendar.events")) {
        return res.send(page("Calendar access needed", "Please tick the box that lets NetworQ add events to your calendar, then try again.", back));
      }
      let email = null;
      try {
        email = JSON.parse(Buffer.from(String(d.id_token || "").split(".")[1] || "", "base64url").toString()).email || null;
      } catch {}
      await deps.saveLink(st.uid, { refresh_token_enc: encrypt(deps.secret, d.refresh_token), email });
      res.send(page("Google Calendar connected ✓", `NetworQ can now create Google Meet invites${email ? ` from ${email}` : ""}. You can close this page.`, back));
    } catch (e) {
      console.warn("[google] callback failed:", e.message);
      res.status(502).send(page("Couldn't connect", "Google didn't complete the connection. Please try again in a moment.", back));
    }
  });

  router.get("/google/status", async (req, res) => {
    const user = await userFrom(req);
    if (!user) return res.status(401).json({ error: "Please sign in again." });
    res.set("Cache-Control", "no-store");
    if (!ready()) return res.json({ available: false, connected: false });
    const row = await deps.loadLink(user.id);
    res.json({ available: true, connected: !!row, email: row?.email || null });
  });

  router.post("/google/disconnect", async (req, res) => {
    const user = await userFrom(req);
    if (!user) return res.status(401).json({ error: "Please sign in again." });
    const row = await deps.loadLink(user.id);
    if (row) {
      try {
        const refresh = decrypt(deps.secret, row.refresh_token_enc);
        await deps.fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: "POST" });
      } catch {}
      await deps.deleteLink(user.id);
    }
    res.json({ ok: true });
  });

  // 3. Create the meeting: a Calendar event with a Google Meet link; Google emails the invite (Accept/Decline)
  router.post("/google/meet", async (req, res) => {
    const user = await userFrom(req);
    if (!user) return res.status(401).json({ error: "Please sign in again." });
    if (!ready()) return res.status(503).json({ error: "Google Calendar isn't set up on this server yet." });
    const { title, description, start, minutes, attendeeEmail } = req.body || {};
    const startAt = new Date(start);
    const mins = Math.min(Math.max(Number(minutes) || 30, 5), 480);
    if (!title || isNaN(startAt.getTime()) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(attendeeEmail || ""))) {
      return res.status(400).json({ error: "Add a date, a time and the person's email." });
    }
    const token = await accessTokenFor(user.id);
    if (!token) return res.status(409).json({ error: "Connect Google Calendar first.", needsConnect: true });
    const r = await deps.fetchImpl("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: String(title).slice(0, 200),
        description: String(description || "Scheduled with NetworQ").slice(0, 2000),
        start: { dateTime: startAt.toISOString() },
        end: { dateTime: new Date(startAt.getTime() + mins * 60000).toISOString() },
        attendees: [{ email: attendeeEmail }],
        conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
        reminders: { useDefault: true },
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.warn("[google] event failed:", r.status, d.error?.message);
      return res.status(502).json({ error: r.status === 403 ? "Google Calendar refused — check that Calendar is enabled for your Google account." : "Google couldn't create the meeting. Please try again." });
    }
    const meetLink = d.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri || d.hangoutLink || "";
    res.json({ meetLink, eventLink: d.htmlLink || "" });
  });

  return router;
}

function productionDeps() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return null;
  const { createClient } = require("@supabase/supabase-js");
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    secret: process.env.LINK_SIGNING_SECRET,
    appUrl: process.env.PUBLIC_APP_URL || "https://www.networq.co.in",
    fetchImpl: (...a) => fetch(...a),
    async getUser(token) {
      const { data, error } = await auth.auth.getUser(token);
      return error ? null : data.user;
    },
    async loadLink(uid) {
      const { data } = await admin.from("google_calendar_links").select("refresh_token_enc, email").eq("user_id", uid).maybeSingle();
      return data || null;
    },
    async saveLink(uid, row) {
      const { error } = await admin.from("google_calendar_links").upsert({ user_id: uid, ...row, connected_at: new Date().toISOString() });
      if (error) throw error;
    },
    async deleteLink(uid) {
      await admin.from("google_calendar_links").delete().eq("user_id", uid);
    },
  };
}

module.exports = { createGoogleRouter, productionDeps, encrypt, decrypt, signState, readState };
