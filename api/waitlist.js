// Waitlist: public sign-up page + join API, a confirmation email per new sign-up, and an
// admin panel (ID + password) listing every sign-up with a CSV export.
//   • the admin panel is OFF unless WAITLIST_ADMIN_PASSWORD is set; the ID is WAITLIST_ADMIN_USER
//     (default "admin"). Sign-in sets a 12-hour signed, HttpOnly session cookie.
//     Open it at https://www.networq.co.in/waitlist/admin
//   • a row is "claimed" (notified=true) before its email is sent, so two servers / the join
//     request and the background timer can never send the same person two emails
//   • the background sender only looks at recent sign-ups, so a deploy never emails the whole list
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { waitlistConfirmation, render } = require("./_lib/emails");
const { sendTransactional } = require("./_lib/mailer");

const EMAIL_RE = /^[^\s@<>,;"'`]+@[^\s@<>,;"'`]+\.[^\s@<>,;"'`]+$/;
const RECENT_MS = 24 * 60 * 60 * 1000;

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

function sha(s) {
  return crypto.createHash("sha256").update(String(s)).digest();
}

const SESSION_COOKIE = "nq_wl_admin";
const SESSION_MS = 12 * 60 * 60 * 1000;

function adminCreds() {
  const password = process.env.WAITLIST_ADMIN_PASSWORD;
  return password ? { user: process.env.WAITLIST_ADMIN_USER || "admin", password } : null;
}
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// Session = "<expiry>.<HMAC(expiry)>", keyed by the credentials + a server secret, so changing the
// password signs everyone out and the cookie can't be forged
function signSession(c, exp) {
  const key = sha(`nq-wl-admin|${c.user}|${c.password}|${process.env.SUPABASE_SERVICE_ROLE_KEY || ""}`);
  return `${exp}.${crypto.createHmac("sha256", key).update(String(exp)).digest("base64url")}`;
}
function readCookie(req, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || "");
  return m ? m[1] : "";
}
function hasSession(req, c) {
  const raw = readCookie(req, SESSION_COOKIE);
  const exp = Number(raw.split(".")[0]);
  return !!raw && exp > Date.now() && safeEqual(raw, signSession(c, exp));
}
// Basic auth still works for scripts (e.g. a Google Sheets IMPORTDATA proxy): ID:password
function hasBasic(req, c) {
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!m) return false;
  const d = Buffer.from(m[1], "base64").toString("utf8");
  const i = d.indexOf(":");
  if (i < 0) return false;
  const userOk = safeEqual(d.slice(0, i), c.user);
  const passOk = safeEqual(d.slice(i + 1), c.password);
  return userOk && passOk;
}
function adminHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("X-Frame-Options", "DENY");
}
function cookieFlags(req) {
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  return `Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}
const adminBase = (req) => `${req.baseUrl || "/waitlist"}/admin`;

/**
 * Claims the row (notified=false → true) and sends the confirmation; un-claims if sending fails.
 */
async function sendWaitlistEmail(supabase, email, position, { mailer = sendTransactional } = {}) {
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
    const appUrl = process.env.PUBLIC_APP_URL || "https://www.networq.co.in";
    const { subject, html, text } = await render(waitlistConfirmation({ email: clean, position, appUrl }));
    await mailer({ to: clean, subject, html, text });
    return { ok: true };
  } catch (err) {
    await supabase.from("waitlist").update({ notified: false }).eq("email", clean);
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
    const { data, error } = await supabase
      .from("waitlist")
      .select("email, position")
      .eq("notified", false)
      .gte("created_at", new Date(Date.now() - RECENT_MS).toISOString())
      .order("created_at", { ascending: true })
      .limit(20);
    if (error || !data || !data.length) return { processed: 0 };
    let count = 0;
    for (const row of data) {
      const r = await sendWaitlistEmail(supabase, row.email, row.position, opts);
      if (r.ok) count++;
    }
    return { processed: count };
  } catch (err) {
    console.warn("[Waitlist] Background email error:", err.message);
    return { processed: 0 };
  }
}

/**
 * Express handler, mounted at /waitlist and /api/waitlist (req.path is relative to the mount)
 */
function waitlistHandler(req, res) {
  const p = (req.path || "/").replace(/\/+$/, "") || "/";
  if (req.method === "GET" && (p === "/admin" || p === "/dashboard")) return handleAdmin(req, res);
  if (req.method === "POST" && p === "/admin/login") return handleLogin(req, res);
  if (req.method === "POST" && p === "/admin/logout") return handleLogout(req, res);
  if (req.method === "GET" && (p === "/admin/export.csv" || p === "/export" || p === "/export.csv")) return handleCsvExport(req, res);
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
    if (!alreadyExists) sendWaitlistEmail(getAdmin(), email, data?.position || null).catch(() => {});
    return res.status(200).json({
      ok: true,
      already_exists: alreadyExists,
      position: data?.position || null,
      show_position: !!data?.show_position,
      message: alreadyExists ? "You're already on the waitlist!" : "You've successfully joined the waitlist!",
    });
  } catch (err) {
    console.error("[Waitlist] Join error:", err.message);
    return res.status(500).json({ error: "Couldn't add you to the waitlist. Please try again." });
  }
}

async function loadRows() {
  const supabase = getAdmin();
  if (!supabase) return { rows: [], error: "Database service key not configured." };
  const { data, error } = await supabase
    .from("waitlist")
    .select("id, email, position, created_at, notified")
    .order("created_at", { ascending: false });
  return error ? { rows: [], error: "Couldn't load the waitlist." } : { rows: data || [], error: "" };
}

async function handleCsvExport(req, res) {
  adminHeaders(res);
  const c = adminCreds();
  if (!c) return res.status(404).send("Not found");
  if (!hasSession(req, c) && !hasBasic(req, c)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="NetworQ waitlist", charset="UTF-8"');
    return res.status(401).send("Sign in at /waitlist/admin first.");
  }
  const { rows, error } = await loadRows();
  if (error) return res.status(503).send(error);
  let csv = "Position,Email,Joined At,Confirmation Sent,ID\r\n";
  for (const r of rows) {
    csv += [r.position ?? "", r.email, r.created_at ? new Date(r.created_at).toISOString() : "", r.notified ? "Yes" : "No", r.id]
      .map(csvCell)
      .join(",") + "\r\n";
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="networq-waitlist.csv"');
  return res.status(200).send(csv);
}

async function handleAdmin(req, res) {
  adminHeaders(res);
  const c = adminCreds();
  if (!c) return res.status(404).send(offPage());
  if (hasSession(req, c) || hasBasic(req, c)) return renderDashboard(req, res, c);
  return res.status(200).send(loginPage(req));
}

async function handleLogin(req, res) {
  adminHeaders(res);
  const c = adminCreds();
  if (!c) return res.status(404).send("Not found");
  const userOk = safeEqual(String(req.body?.id ?? ""), c.user);
  const passOk = safeEqual(String(req.body?.password ?? ""), c.password);
  if (!userOk || !passOk) return res.status(401).send(loginPage(req, "Wrong ID or password."));
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${signSession(c, Date.now() + SESSION_MS)}; Max-Age=${SESSION_MS / 1000}; ${cookieFlags(req)}`);
  return res.redirect(303, adminBase(req));
}

function handleLogout(req, res) {
  adminHeaders(res);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
  return res.redirect(303, adminBase(req));
}

// Admin UI — enterprise CRM look (light, dense, list view), official NetworQ wordmark
const LOGO = "/brand/networq-wordmark.png";
const STYLE = `
    :root {
      --brand: #4B3BEA; --brand-dark: #3A2BC9; --brand-soft: #EEECFD;
      --page: #F3F3F3; --surface: #FFFFFF; --border: #DDDBDA; --border-strong: #C9C7C5;
      --text: #181818; --text-2: #444444; --muted: #706E6B;
      --ok-bg: #E3F5E9; --ok: #2E844A; --warn-bg: #FEF1E3; --warn: #A96404; --err-bg: #FDECEA; --err: #BA0517;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 13px; color: var(--text); background: var(--page); min-height: 100vh; -webkit-font-smoothing: antialiased; }
    a { color: var(--brand); text-decoration: none; }
    button { font: inherit; }

    /* Global header + app nav */
    .global { height: 52px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 16px; gap: 12px; }
    .global img { height: 24px; display: block; }
    .user { display: flex; align-items: center; gap: 10px; color: var(--text-2); }
    .avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--brand); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 13px; text-transform: uppercase; }
    .appnav { height: 44px; background: var(--surface); border-bottom: 3px solid var(--brand); display: flex; align-items: stretch; padding: 0 16px; gap: 20px; box-shadow: 0 2px 2px rgba(0,0,0,0.05); }
    .appname { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 700; padding-right: 20px; border-right: 1px solid var(--border); }
    .launcher { display: grid; grid-template-columns: repeat(3, 4px); gap: 3px; }
    .launcher i { width: 4px; height: 4px; border-radius: 50%; background: var(--muted); }
    .tab { display: flex; align-items: center; font-size: 13px; color: var(--text-2); border-bottom: 3px solid transparent; margin-bottom: -3px; padding: 0 4px; }
    .tab.active { color: var(--text); font-weight: 700; border-bottom-color: var(--brand-dark); }

    .wrap { padding: 12px; max-width: 1280px; margin: 0 auto; }
    .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; box-shadow: 0 2px 2px rgba(0,0,0,0.04); }

    /* List view header */
    .lv-head { padding: 12px 16px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
    .lv-title { display: flex; gap: 12px; align-items: center; }
    .icon-tile { width: 32px; height: 32px; border-radius: 4px; background: var(--brand); display: grid; place-items: center; flex: none; }
    .eyebrow { font-size: 12px; color: var(--text-2); }
    h1 { font-size: 18px; font-weight: 700; line-height: 1.25; }
    .meta { font-size: 12px; color: var(--muted); padding: 0 16px 10px; }
    .btn-group { display: flex; flex-wrap: wrap; gap: 0; }
    .btn { height: 32px; padding: 0 14px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--brand); border-radius: 4px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; }
    .btn:hover { background: #F7F7F7; }
    .btn-group .btn { border-radius: 0; margin-left: -1px; }
    .btn-group .btn:first-child { border-radius: 4px 0 0 4px; margin-left: 0; }
    .btn-group .btn:last-child { border-radius: 0 4px 4px 0; }
    .btn-brand { background: var(--brand); border-color: var(--brand); color: #fff; }
    .btn-brand:hover { background: var(--brand-dark); }
    .btn-plain { border: none; background: none; color: var(--brand); padding: 0 6px; }

    /* Highlights strip */
    .highlights { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--border); }
    .hl { padding: 10px 16px; border-right: 1px solid var(--border); }
    .hl:last-child { border-right: none; }
    .hl-label { font-size: 12px; color: var(--muted); }
    .hl-val { font-size: 18px; font-weight: 700; margin-top: 2px; }
    .hl-sub { font-size: 12px; color: var(--muted); font-weight: 400; margin-left: 4px; }

    /* Toolbar + table */
    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 16px; border-top: 1px solid var(--border); flex-wrap: wrap; }
    .search { position: relative; }
    .search svg { position: absolute; left: 10px; top: 9px; }
    .search input { height: 32px; width: 260px; max-width: 100%; border: 1px solid var(--border-strong); border-radius: 4px; padding: 0 10px 0 30px; font-size: 13px; color: var(--text); background: var(--surface); outline: none; }
    .search input:focus, .field input:focus { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
    .table-wrap { overflow-x: auto; border-top: 1px solid var(--border); }
    table { width: 100%; border-collapse: collapse; }
    th { background: #FAFAF9; text-align: left; font-size: 12px; font-weight: 700; color: var(--text-2); padding: 8px 12px; border-bottom: 1px solid var(--border); border-right: 1px solid #EBEBEB; white-space: nowrap; user-select: none; }
    th[data-key] { cursor: pointer; }
    th[data-key]:hover { background: #F3F3F3; }
    th .arrow { color: var(--muted); font-size: 10px; margin-left: 4px; }
    td { padding: 8px 12px; border-bottom: 1px solid #EBEBEB; white-space: nowrap; color: var(--text); }
    tbody tr:hover td { background: #F3F3F3; }
    td.num { color: var(--muted); width: 48px; text-align: right; }
    td.email { color: var(--brand); font-weight: 500; }
    .pill { display: inline-block; font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 12px; }
    .pill-ok { background: var(--ok-bg); color: var(--ok); }
    .pill-warn { background: var(--warn-bg); color: var(--warn); }
    .empty { padding: 48px 16px; text-align: center; color: var(--muted); }
    .alert { margin: 0 16px 10px; padding: 8px 12px; border-radius: 4px; background: var(--err-bg); color: var(--err); font-size: 13px; }

    /* Sign-in */
    .login { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 10vh 16px 24px; }
    .login img { height: 36px; margin-bottom: 24px; }
    .login-card { width: 100%; max-width: 380px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.06); }
    .login-card h1 { font-size: 16px; margin-bottom: 4px; }
    .field { margin-top: 16px; }
    .field label { display: block; font-size: 13px; color: var(--text-2); margin-bottom: 4px; }
    .field input { width: 100%; height: 40px; border: 1px solid var(--border-strong); border-radius: 4px; padding: 0 12px; font-size: 15px; color: var(--text); outline: none; background: #fff; }
    .login .btn-brand { width: 100%; height: 40px; justify-content: center; margin-top: 20px; font-size: 14px; }
    .login .alert { margin: 16px 0 0; }
    .fine { font-size: 12px; color: var(--muted); margin-top: 16px; text-align: center; }

    @media (max-width: 720px) {
      .highlights { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .hl:nth-child(2) { border-right: none; }
      .hl:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
      .user .who { display: none; }
      .search, .search input { width: 100%; }
    }`;

const USERS_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
const SEARCH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#706E6B" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;

function page(title, body, script = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <title>${escapeHtml(title)} | NetworQ</title>
  <style>${STYLE}</style>
</head>
<body>
${body}
${script}
</body>
</html>`;
}

function offPage() {
  return page(
    "Admin",
    `<div class="login"><img src="${LOGO}" alt="NetworQ" />
    <div class="login-card"><h1>Admin is not set up</h1>
    <p class="fine" style="text-align:left">Add <b>WAITLIST_ADMIN_USER</b> and <b>WAITLIST_ADMIN_PASSWORD</b> in the server's environment settings to turn it on.</p></div></div>`
  );
}

function loginPage(req, error = "") {
  return page(
    "Log in",
    `<main class="login">
    <img src="${LOGO}" alt="NetworQ" />
    <form class="login-card" method="post" action="${escapeHtml(adminBase(req))}/login">
      <h1>Log in to NetworQ Admin</h1>
      <p class="fine" style="text-align:left;margin-top:0">Waitlist sign-ups</p>
      ${error ? `<div class="alert" role="alert">${escapeHtml(error)}</div>` : ""}
      <div class="field"><label for="id">Admin ID</label>
        <input id="id" name="id" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus /></div>
      <div class="field"><label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required /></div>
      <button class="btn btn-brand" type="submit">Log In</button>
    </form>
    <p class="fine">Authorised NetworQ staff only · © ${new Date().getFullYear()} NetworQ</p>
  </main>`
  );
}

async function renderDashboard(req, res, c) {
  const { rows, error: errorMsg } = await loadRows();
  const base = adminBase(req);
  const istDay = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const today = istDay(Date.now());
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const total = rows.length;
  const sent = rows.filter((r) => r.notified).length;
  const highlights = [
    ["Total sign-ups", total, ""],
    ["Joined today", rows.filter((r) => r.created_at && istDay(r.created_at) === today).length, ""],
    ["Last 7 days", rows.filter((r) => r.created_at && new Date(r.created_at).getTime() > weekAgo).length, ""],
    ["Confirmation emails sent", sent, total ? `${Math.round((sent / total) * 100)}%` : ""],
  ];
  const updated = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
  const who = c ? c.user : "admin";

  const body = `<header class="global">
    <img src="${LOGO}" alt="NetworQ" />
    <div class="user">
      <span class="who">${escapeHtml(who)}</span>
      <span class="avatar" aria-hidden="true">${escapeHtml(who.slice(0, 2))}</span>
      <form method="post" action="${escapeHtml(base)}/logout"><button class="btn btn-plain" type="submit">Log out</button></form>
    </div>
  </header>
  <nav class="appnav" aria-label="Admin">
    <div class="appname"><span class="launcher" aria-hidden="true">${"<i></i>".repeat(9)}</span>Admin</div>
    <a class="tab active" href="${escapeHtml(base)}" aria-current="page">Waitlist</a>
  </nav>

  <main class="wrap">
    <section class="panel">
      <div class="lv-head">
        <div class="lv-title">
          <span class="icon-tile">${USERS_ICON}</span>
          <div><div class="eyebrow">Waitlist</div><h1>All Sign-ups</h1></div>
        </div>
        <div class="btn-group">
          <a class="btn" href="${escapeHtml(base)}">Refresh</a>
          <a class="btn" href="${escapeHtml(base)}/export.csv">Export CSV</a>
        </div>
      </div>
      <div class="meta"><span id="count">${total}</span> items · Sorted by Joined · Updated ${escapeHtml(updated)} IST</div>
      ${errorMsg ? `<div class="alert" role="alert">${escapeHtml(errorMsg)}</div>` : ""}
      <div class="highlights">
        ${highlights.map(([l, v, sub]) => `<div class="hl"><div class="hl-label">${l}</div><div class="hl-val">${v}${sub ? `<span class="hl-sub">${sub}</span>` : ""}</div></div>`).join("")}
      </div>
      <div class="toolbar">
        <div class="search">${SEARCH_ICON}<input type="search" id="search" placeholder="Search this list…" aria-label="Search this list" /></div>
        <span class="eyebrow">Sources: waitlist.networq.co.in · networq.co.in</span>
      </div>
      <div class="table-wrap">
        <table id="waitlist-table">
          <thead><tr>
            <th style="text-align:right">#</th>
            <th data-key="email" data-type="text">Email<span class="arrow"></span></th>
            <th data-key="pos" data-type="num">Queue position<span class="arrow"></span></th>
            <th data-key="joined" data-type="num">Joined (IST)<span class="arrow">▼</span></th>
            <th data-key="status" data-type="text">Confirmation email<span class="arrow"></span></th>
          </tr></thead>
          <tbody>
            ${
              total === 0
                ? `<tr><td colspan="5" class="empty">No sign-ups yet. They'll appear here as soon as someone joins.</td></tr>`
                : rows
                    .map((r, i) => {
                      const t = r.created_at ? new Date(r.created_at).getTime() : 0;
                      const date = t ? new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
                      return `<tr data-email="${escapeHtml(r.email || "")}" data-pos="${Number(r.position) || 0}" data-joined="${t}" data-status="${r.notified ? "sent" : "queued"}">
                        <td class="num">${i + 1}</td>
                        <td class="email">${escapeHtml(r.email || "—")}</td>
                        <td>${escapeHtml(r.position ?? "—")}</td>
                        <td>${escapeHtml(date)}</td>
                        <td>${r.notified ? `<span class="pill pill-ok">Sent</span>` : `<span class="pill pill-warn">Queued</span>`}</td>
                      </tr>`;
                    })
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>`;

  const script = `<script>
    (function () {
      var tbody = document.querySelector('#waitlist-table tbody');
      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-email]'));
      var count = document.getElementById('count');
      function renumber() {
        var n = 0;
        rows.forEach(function (tr) { if (tr.style.display !== 'none') tr.firstElementChild.textContent = ++n; });
        count.textContent = n;
      }
      document.getElementById('search').addEventListener('input', function (e) {
        var q = e.target.value.toLowerCase();
        rows.forEach(function (tr) { tr.style.display = tr.innerText.toLowerCase().indexOf(q) !== -1 ? '' : 'none'; });
        renumber();
      });
      var sortKey = 'joined', dir = -1;
      document.querySelectorAll('th[data-key]').forEach(function (th) {
        th.addEventListener('click', function () {
          var key = th.getAttribute('data-key'), num = th.getAttribute('data-type') === 'num';
          dir = key === sortKey ? -dir : (num ? -1 : 1); sortKey = key;
          rows.sort(function (a, b) {
            var x = a.getAttribute('data-' + key), y = b.getAttribute('data-' + key);
            return (num ? (Number(x) - Number(y)) : x.localeCompare(y)) * dir;
          });
          rows.forEach(function (tr) { tbody.appendChild(tr); });
          document.querySelectorAll('th .arrow').forEach(function (s) { s.textContent = ''; });
          th.querySelector('.arrow').textContent = dir > 0 ? '▲' : '▼';
          document.querySelector('.meta').childNodes[1].textContent = ' items · Sorted by ' + th.childNodes[0].textContent + ' · ';
          renumber();
        });
      });
    })();
  </script>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(page("Waitlist sign-ups", body, script));
}

module.exports = waitlistHandler;
module.exports.waitlistHandler = waitlistHandler;
module.exports.sendWaitlistEmail = sendWaitlistEmail;
module.exports.processPendingWaitlistEmails = processPendingWaitlistEmails;
module.exports.servePage = servePage;
module.exports.csvCell = csvCell;
module.exports.escapeHtml = escapeHtml;
