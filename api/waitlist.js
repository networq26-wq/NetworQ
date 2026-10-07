// Waitlist: public sign-up page + join API, a confirmation email per new sign-up, and a
// password-protected admin dashboard / CSV export.
//   • the dashboard and export list every email address, so they are OFF unless
//     WAITLIST_ADMIN_PASSWORD is set, and then need HTTP Basic auth (any username + that password)
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

// true = allowed; otherwise the response has been sent
function requireAdmin(req, res) {
  const password = process.env.WAITLIST_ADMIN_PASSWORD;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (!password) {
    res.status(404).send("Not found");
    return false;
  }
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || "");
  let given = "";
  if (m) {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    given = decoded.slice(decoded.indexOf(":") + 1);
  }
  if (m && crypto.timingSafeEqual(sha(given), sha(password))) return true;
  res.setHeader("WWW-Authenticate", 'Basic realm="NetworQ waitlist", charset="UTF-8"');
  res.status(401).send("Sign in to see the waitlist.");
  return false;
}

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
  if (req.method === "GET" && (p === "/export" || p === "/export.csv")) return handleCsvExport(req, res);
  if (req.method === "GET" && p === "/dashboard") return handleDashboard(req, res);
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
  if (!requireAdmin(req, res)) return;
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

async function handleDashboard(req, res) {
  if (!requireAdmin(req, res)) return;
  const { rows, error: errorMsg } = await loadRows();
  const count = rows.length;
  const notifiedCount = rows.filter((r) => r.notified).length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>NetworQ — Waitlist Dashboard</title>
  <style>
    :root {
      --bg: #0C0E1A;
      --card: #151828;
      --border: #262B45;
      --text: #F3F4F8;
      --muted: #8E95AA;
      --accent: #8B5CF6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; padding: 32px 16px; }
    .container { max-width: 980px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; flex-wrap: wrap; gap: 16px; }
    .brand { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; }
    .brand span { color: var(--accent); }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; }
    .btn { background: var(--accent); color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 10px; font-weight: 600; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; }
    .btn-secondary { background: var(--card); border: 1px solid var(--border); color: var(--text); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
    .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 20px; }
    .stat-label { font-size: 13px; color: var(--muted); font-weight: 500; margin-bottom: 6px; }
    .stat-val { font-size: 32px; font-weight: 800; color: #fff; letter-spacing: -0.03em; }
    .search-box { width: 100%; padding: 12px 16px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; color: #fff; font-size: 15px; margin-bottom: 18px; outline: none; }
    .table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: 14px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
    th { padding: 14px 18px; color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); }
    td { padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.05); color: #D1D5DB; }
    tr:last-child td { border-bottom: none; }
    .pos-badge { background: rgba(139, 92, 246, 0.15); color: var(--accent); padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 13px; }
    .status-badge { font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 6px; }
    .status-sent { background: rgba(16, 185, 129, 0.15); color: #34D399; }
    .status-pending { background: rgba(245, 158, 11, 0.15); color: #FBBF24; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="brand">Networ<span>Q</span> <span style="font-size:14px;font-weight:500;color:var(--muted);margin-left:8px;">Waitlist Dashboard</span></div>
        <div style="font-size:13px;color:var(--muted);margin-top:4px;">Live sign-ups from the website</div>
      </div>
      <div class="actions">
        <a href="/api/waitlist/export.csv" class="btn">Download CSV (Google Sheets)</a>
        <a href="https://supabase.com/dashboard/project/jpuxmkkuzqojqeatespa/editor" target="_blank" rel="noopener" class="btn btn-secondary">Open Supabase</a>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Total sign-ups</div><div class="stat-val">${count}</div></div>
      <div class="stat-card"><div class="stat-label">Confirmation emails sent</div><div class="stat-val" style="color:#34D399;">${notifiedCount}</div></div>
      <div class="stat-card"><div class="stat-label">Database</div><div class="stat-val" style="font-size:20px;color:${errorMsg ? "#EF4444" : "#34D399"};">${errorMsg ? escapeHtml(errorMsg) : "Live"}</div></div>
    </div>

    <input type="search" id="search" class="search-box" placeholder="Search email or position" aria-label="Search the waitlist" />

    <div class="table-wrap">
      <table id="waitlist-table">
        <thead><tr><th>Pos</th><th>Email</th><th>Joined</th><th>Email status</th></tr></thead>
        <tbody>
          ${
            rows.length === 0
              ? `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--muted);">No sign-ups yet.</td></tr>`
              : rows
                  .map((r) => {
                    const date = r.created_at ? new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST" : "—";
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
  </div>
  <script>
    document.getElementById('search').addEventListener('input', function (e) {
      var q = e.target.value.toLowerCase();
      document.querySelectorAll('#waitlist-table tbody tr').forEach(function (tr) {
        tr.style.display = tr.innerText.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
      });
    });
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
}

module.exports = waitlistHandler;
module.exports.waitlistHandler = waitlistHandler;
module.exports.sendWaitlistEmail = sendWaitlistEmail;
module.exports.processPendingWaitlistEmails = processPendingWaitlistEmails;
module.exports.servePage = servePage;
module.exports.csvCell = csvCell;
module.exports.escapeHtml = escapeHtml;
