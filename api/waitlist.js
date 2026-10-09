// Waitlist: public sign-up page + join API, one confirmation email per sign-up, and the admin panel
// (api/waitlistAdmin) at /waitlist/admin.
//   • a row is "claimed" (notified=true) before its email is sent, so two servers / the join
//     request and the background timer can never send the same person two emails
//   • the background sender only looks at recent sign-ups (24 h) and gives up after 3 failed tries
//   • new sign-ups also record where they came from (UTM / referrer / referral code), device and
//     time zone — only what the visitor's own browser tells us, nothing from third parties
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { waitlistConfirmation, waitlistInvite, render } = require("./_lib/emails");
const { sendTransactional } = require("./_lib/mailer");
const { createAdminHandler } = require("./waitlistAdmin");
const { createSupabaseStore } = require("./waitlistAdmin/store");

const EMAIL_RE = /^[^\s@<>,;"'`]+@[^\s@<>,;"'`]+\.[^\s@<>,;"'`]+$/;
const RECENT_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const APP_URL = () => process.env.PUBLIC_APP_URL || "https://www.networq.co.in";

// Service role only: reading the list and marking rows needs it (RLS has no policies for anon)
function getAdmin() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}
// Joining works with either key (join_waitlist is granted to anon)
function getJoinClient() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Spreadsheet-safe CSV cell: quote, double quotes, and neutralise formulas (=, +, -, @, tab, CR)
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Claims the row (notified=false → true) and sends the confirmation; un-claims if sending fails.
 */
async function sendWaitlistEmail(supabase, email, position, { mailer = sendTransactional, attempts = 0 } = {}) {
  if (!supabase) return { ok: false, error: "no_service_key" };
  const clean = String(email).toLowerCase().trim();
  const { data: claimed, error } = await supabase
    .from("waitlist")
    .update({ notified: true })
    .eq("email", clean)
    .eq("notified", false)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!claimed || !claimed.length) return { ok: false, skipped: true }; // already sent (or being sent)
  try {
    const { subject, html, text } = await render(waitlistConfirmation({ email: clean, position, appUrl: APP_URL() }));
    await mailer({ to: clean, subject, html, text });
    await supabase.from("waitlist").update({ email_error: null, last_emailed_at: new Date().toISOString() }).eq("email", clean).then(() => {}, () => {});
    return { ok: true };
  } catch (err) {
    await supabase.from("waitlist").update({ notified: false }).eq("email", clean);
    await supabase.from("waitlist").update({ email_error: String(err.message).slice(0, 300), email_attempts: attempts + 1 }).eq("email", clean).then(() => {}, () => {});
    console.warn("[Waitlist] Confirmation email failed:", err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Background: confirmation emails for recent sign-ups that haven't had one (e.g. joined via Supabase directly).
 */
async function processPendingWaitlistEmails(supabase = getAdmin(), opts = {}) {
  if (!supabase) return { processed: 0 };
  try {
    const query = (withAttempts) => {
      let q = supabase.from("waitlist").select(withAttempts ? "email, position, email_attempts" : "email, position").eq("notified", false);
      if (withAttempts) q = q.lt("email_attempts", MAX_ATTEMPTS);
      return q.gte("created_at", new Date(Date.now() - RECENT_MS).toISOString()).order("created_at", { ascending: true }).limit(20);
    };
    let { data, error } = await query(true);
    // Before the 20261020 migration there is no email_attempts column — keep sending anyway
    if (error && /email_attempts/.test(error.message || "")) ({ data, error } = await query(false));
    if (error || !data || !data.length) return { processed: 0 };
    let count = 0;
    for (const row of data) {
      const r = await sendWaitlistEmail(supabase, row.email, row.position, { ...opts, attempts: row.email_attempts || 0 });
      if (r.ok) count++;
    }
    return { processed: count };
  } catch (err) {
    console.warn("[Waitlist] Background email error:", err.message);
    return { processed: 0 };
  }
}

// ── Admin panel wiring ───────────────────────────────────────────────────────
function defaultAdminDeps() {
  const sb = getAdmin();
  const store = sb
    ? createSupabaseStore(sb)
    : new Proxy({}, { get: (_, name) => async () => { if (["audit", "syncJoined", "touchAdmin"].includes(name)) return null; throw new Error("Database service key not configured."); } });
  const mail = async (tpl, to) => {
    const { subject, html, text } = await render(tpl);
    await sendTransactional({ to, subject, html, text });
    return { ok: true };
  };
  return {
    store,
    // Already confirmed → send again directly; not yet → claim first so the background job can't double-send
    sendConfirmation: async (row) =>
      row.notified
        ? mail(waitlistConfirmation({ email: row.email, position: row.position, appUrl: APP_URL() }), row.email)
        : sendWaitlistEmail(sb, row.email, row.position, { attempts: row.email_attempts || 0 }),
    sendInvite: (row) => mail(waitlistInvite({ appUrl: APP_URL() }), row.email),
  };
}
let adminDeps = defaultAdminDeps;
let adminHandler = null;
// Production builds deps per request (fresh env); injected test deps are kept for the whole test
function admin() {
  if (adminDeps === defaultAdminDeps) return createAdminHandler(defaultAdminDeps());
  if (!adminHandler) adminHandler = createAdminHandler(adminDeps());
  return adminHandler;
}

/**
 * Express handler, mounted at /waitlist and /api/waitlist (req.path is relative to the mount)
 */
function waitlistHandler(req, res) {
  const p = (req.path || "/").replace(/\/+$/, "") || "/";
  const base = `${req.baseUrl || "/waitlist"}/admin`;
  if (p === "/admin" || p.startsWith("/admin/")) return admin()(req, res, p.slice("/admin".length), base);
  if (req.method === "GET" && p === "/dashboard") return res.redirect(303, base);
  if (req.method === "GET" && (p === "/export" || p === "/export.csv")) return admin()(req, res, "/export.csv", base);
  if (req.method === "POST" && (p === "/join" || p === "/")) return handleJoin(req, res);
  if (req.method === "GET" && p === "/") return servePage(req, res);
  return res.status(404).send("Not found");
}

function servePage(req, res) {
  const htmlPath = path.join(__dirname, "..", "public", "waitlist.html");
  if (!fs.existsSync(htmlPath)) return res.status(404).send("Waitlist page not found");
  const injected = fs
    .readFileSync(htmlPath, "utf8")
    .replace("'REPLACE_WITH_YOUR_SUPABASE_URL'", `'${process.env.EXPO_PUBLIC_SUPABASE_URL || ""}'`)
    .replace("'REPLACE_WITH_YOUR_SUPABASE_ANON_KEY'", `'${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ""}'`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(injected);
}

// What the visitor's browser tells us about the sign-up (all optional, all trimmed)
function signupDetails(req) {
  const b = req.body || {};
  const txt = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) || null;
  const lower = (v, max) => txt(v, max)?.toLowerCase() || null;
  const ua = String(req.headers["user-agent"] || "");
  const device = /iPad|Tablet|PlayBook|Silk/i.test(ua) ? "tablet" : /Mobi|Android|iPhone|iPod/i.test(ua) ? "mobile" : ua ? "desktop" : null;
  let referrer = txt(b.referrer, 300);
  if (referrer && !/^https?:\/\//i.test(referrer)) referrer = null;
  const tz = txt(b.tz, 60);
  return {
    source: lower(b.source, 60),
    utm_source: lower(b.utm_source, 60),
    utm_medium: lower(b.utm_medium, 60),
    utm_campaign: lower(b.utm_campaign, 100),
    referrer,
    timezone: tz && /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(tz) ? tz : null,
    device,
    ref: /^[0-9a-f]{8}$/.test(String(b.ref || "")) ? String(b.ref) : null,
  };
}

async function handleJoin(req, res) {
  const email = String(req.body?.email || req.body?.p_email || "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  const supabase = getJoinClient();
  if (!supabase) return res.status(503).json({ error: "The waitlist is unavailable right now. Please try again soon." });
  try {
    const { data, error } = await supabase.rpc("join_waitlist", { p_email: email });
    if (error) {
      console.warn("[Waitlist] join_waitlist error:", error.message);
      return res.status(500).json({ error: "Couldn't add you to the waitlist. Please try again." });
    }
    const alreadyExists = !!data?.already_exists;
    if (!alreadyExists) {
      const sb = getAdmin();
      if (sb) {
        const { ref, ...details } = signupDetails(req);
        const patch = Object.fromEntries(Object.entries(details).filter(([, v]) => v));
        if (ref && ref !== data?.ref_code) {
          const { data: referrer } = await sb.from("waitlist").select("id").eq("ref_code", ref).maybeSingle().then((r) => r, () => ({ data: null }));
          if (referrer) patch.referred_by = ref;
        }
        if (Object.keys(patch).length) await sb.from("waitlist").update(patch).eq("email", email).then(() => {}, () => {});
      }
      sendWaitlistEmail(sb, email, data?.position || null).catch(() => {});
    }
    return res.status(200).json({
      ok: true,
      already_exists: alreadyExists,
      position: data?.position || null,
      ref_code: data?.ref_code || null,
      show_position: !!data?.show_position,
      message: alreadyExists ? "You're already on the waitlist!" : "You've successfully joined the waitlist!",
    });
  } catch (err) {
    console.error("[Waitlist] Join error:", err.message);
    return res.status(500).json({ error: "Couldn't add you to the waitlist. Please try again." });
  }
}

module.exports = waitlistHandler;
module.exports.waitlistHandler = waitlistHandler;
module.exports.sendWaitlistEmail = sendWaitlistEmail;
module.exports.processPendingWaitlistEmails = processPendingWaitlistEmails;
module.exports.servePage = servePage;
module.exports.signupDetails = signupDetails;
module.exports.csvCell = csvCell;
module.exports.escapeHtml = escapeHtml;
// Tests / local previews: swap the admin panel's store and email senders
module.exports.setAdminDeps = (fn) => {
  adminDeps = fn || defaultAdminDeps;
  adminHandler = null;
};
