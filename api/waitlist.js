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
  if (!c) return res.status(404).send(page("Admin not set up", `<div class="card narrow"><h1>Admin panel is off</h1><p class="muted">Set <b>WAITLIST_ADMIN_USER</b> and <b>WAITLIST_ADMIN_PASSWORD</b> on the server to turn it on.</p></div>`));
  if (hasSession(req, c) || hasBasic(req, c)) return renderDashboard(req, res);
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

const STYLE = `
    :root { --bg:#0C0E1A; --card:#151828; --border:#262B45; --text:#F3F4F8; --muted:#8E95AA; --accent:#8B5CF6; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; padding: 32px 16px; }
    .container { max-width: 1000px; margin: 0 auto; }
    .brand { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; }
    .brand span { color: var(--accent); }
    .muted { color: var(--muted); font-size: 14px; line-height: 1.5; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 24px; }
    .narrow { max-width: 400px; margin: 10vh auto 0; }
    h1 { font-size: 22px; margin: 18px 0 6px; }
    label { display: block; font-size: 13px; color: var(--muted); margin: 18px 0 6px; font-weight: 600; }
    input { width: 100%; padding: 14px 16px; background: #0F1220; border: 1px solid var(--border); border-radius: 12px; color: #fff; font-size: 16px; outline: none; }
    input:focus { border-color: var(--accent); }
    .btn { background: var(--accent); color: #fff; text-decoration: none; padding: 12px 18px; border-radius: 12px; font-weight: 600; font-size: 15px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: none; cursor: pointer; min-height: 44px; }
    .btn-secondary { background: var(--card); border: 1px solid var(--border); color: var(--text); }
    .full { width: 100%; margin-top: 22px; }
    .error { background: rgba(239,68,68,0.12); color: #FCA5A5; border: 1px solid rgba(239,68,68,0.3); padding: 10px 12px; border-radius: 10px; font-size: 14px; margin-top: 16px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .stat-label { font-size: 13px; color: var(--muted); font-weight: 500; margin-bottom: 6px; }
    .stat-val { font-size: 30px; font-weight: 800; letter-spacing: -0.03em; }
    .search-box { margin-bottom: 16px; }
    .table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: 14px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
    th { padding: 14px 18px; color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); white-space: nowrap; }
    td { padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.05); color: #D1D5DB; white-space: nowrap; }
    tr:last-child td { border-bottom: none; }
    .pos-badge { background: rgba(139,92,246,0.15); color: #A78BFA; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 13px; }
    .status-badge { font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 6px; }
    .status-sent { background: rgba(16,185,129,0.15); color: #34D399; }
    .status-pending { background: rgba(245,158,11,0.15); color: #FBBF24; }`;

function page(title, body, script = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <title>${escapeHtml(title)} — NetworQ</title>
  <style>${STYLE}</style>
</head>
<body>
${body}
${script}
</body>
</html>`;
}

function loginPage(req, error = "") {
  return page(
    "Waitlist admin",
    `<form class="card narrow" method="post" action="${escapeHtml(adminBase(req))}/login">
    <div class="brand">Networ<span>Q</span></div>
    <h1>Waitlist admin</h1>
    <p class="muted">Sign in to see everyone who joined the waitlist.</p>
    ${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ""}
    <label for="id">Admin ID</label>
    <input id="id" name="id" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <button class="btn full" type="submit">Sign in</button>
  </form>`
  );
}

async function renderDashboard(req, res) {
  const { rows, error: errorMsg } = await loadRows();
  const base = adminBase(req);
  const istDay = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const today = istDay(Date.now());
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const stats = [
    ["Total sign-ups", rows.length, "#fff"],
    ["Today", rows.filter((r) => r.created_at && istDay(r.created_at) === today).length, "#A78BFA"],
    ["Last 7 days", rows.filter((r) => r.created_at && new Date(r.created_at).getTime() > weekAgo).length, "#A78BFA"],
    ["Confirmation emails sent", rows.filter((r) => r.notified).length, "#34D399"],
  ];
  const body = `<div class="container">
    <div class="header">
      <div>
        <div class="brand">Networ<span>Q</span> <span class="muted" style="font-weight:500;margin-left:8px;">Waitlist admin</span></div>
        <div class="muted" style="margin-top:4px;">${errorMsg ? `<span style="color:#FCA5A5">${escapeHtml(errorMsg)}</span>` : "Live sign-ups from waitlist.networq.co.in and networq.co.in"}</div>
      </div>
      <div class="actions">
        <a href="${escapeHtml(base)}" class="btn btn-secondary">Refresh</a>
        <a href="${escapeHtml(base)}/export.csv" class="btn">Download CSV (Google Sheets)</a>
        <form method="post" action="${escapeHtml(base)}/logout"><button class="btn btn-secondary" type="submit">Sign out</button></form>
      </div>
    </div>

    <div class="stats-grid">
      ${stats.map(([label, val, color]) => `<div class="card"><div class="stat-label">${label}</div><div class="stat-val" style="color:${color}">${val}</div></div>`).join("")}
    </div>

    <input type="search" id="search" class="search-box" placeholder="Search email or position" aria-label="Search the waitlist" />

    <div class="table-wrap">
      <table id="waitlist-table">
        <thead><tr><th>Pos</th><th>Email</th><th>Joined (IST)</th><th>Email status</th></tr></thead>
        <tbody>
          ${
            rows.length === 0
              ? `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--muted);">No sign-ups yet.</td></tr>`
              : rows
                  .map((r) => {
                    const date = r.created_at ? new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—";
                    return `<tr>
                      <td><span class="pos-badge">#${escapeHtml(r.position ?? "—")}</span></td>
                      <td style="font-weight:600;color:#fff;">${escapeHtml(r.email || "—")}</td>
                      <td style="color:var(--muted);font-size:13px;">${escapeHtml(date)}</td>
                      <td>${r.notified ? `<span class="status-badge status-sent">Sent</span>` : `<span class="status-badge status-pending">In queue</span>`}</td>
                    </tr>`;
                  })
                  .join("")
          }
        </tbody>
      </table>
    </div>
  </div>`;
  const script = `<script>
    document.getElementById('search').addEventListener('input', function (e) {
      var q = e.target.value.toLowerCase();
      document.querySelectorAll('#waitlist-table tbody tr').forEach(function (tr) {
        tr.style.display = tr.innerText.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
      });
    });
  </script>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(page("Waitlist admin", body, script));
}

module.exports = waitlistHandler;
module.exports.waitlistHandler = waitlistHandler;
module.exports.sendWaitlistEmail = sendWaitlistEmail;
module.exports.processPendingWaitlistEmails = processPendingWaitlistEmails;
module.exports.servePage = servePage;
module.exports.csvCell = csvCell;
module.exports.escapeHtml = escapeHtml;
