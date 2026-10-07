const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { waitlistConfirmation, render } = require("./_lib/emails");
const { sendTransactional } = require("./_lib/mailer");

function getSupabase() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/**
 * Sends confirmation email to a waitlist member and updates notified=true in Supabase
 */
async function sendWaitlistEmail(supabase, email, position) {
  try {
    const appUrl = process.env.PUBLIC_APP_URL || "https://www.networq.co.in";
    const template = waitlistConfirmation({ email, position, appUrl });
    const { subject, html, text } = await render(template);

    await sendTransactional({
      to: email,
      subject,
      html,
      text,
    });

    if (supabase) {
      await supabase
        .from("waitlist")
        .update({ notified: true })
        .eq("email", email.toLowerCase().trim());
    }
    return { ok: true };
  } catch (err) {
    console.warn(`[Waitlist] Failed to send welcome email to ${email}:`, err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Background processor: scans any waitlist rows that haven't received confirmation email yet
 */
async function processPendingWaitlistEmails(supabase = getSupabase()) {
  if (!supabase) return { processed: 0 };
  try {
    const { data, error } = await supabase
      .from("waitlist")
      .select("id, email, position, notified")
      .eq("notified", false)
      .limit(20);

    if (error || !data || !data.length) return { processed: 0 };

    let count = 0;
    for (const row of data) {
      const res = await sendWaitlistEmail(supabase, row.email, row.position);
      if (res.ok) count++;
    }
    return { processed: count };
  } catch (err) {
    console.warn("[Waitlist] Background email processor error:", err.message);
    return { processed: 0, error: err.message };
  }
}

/**
 * Main Express waitlist controller
 */
function waitlistHandler(req, res) {
  const fullUrl = req.originalUrl || req.url || req.path || "";

  // ── CSV Export ──
  if (fullUrl.includes("/export")) {
    return handleCsvExport(req, res);
  }

  // ── Live Admin Dashboard ──
  if (fullUrl.includes("/dashboard")) {
    return handleDashboard(req, res);
  }

  // ── Join Waitlist API ──
  if (req.method === "POST" && (fullUrl.includes("/join") || fullUrl.endsWith("/waitlist"))) {
    return handleJoin(req, res);
  }

  // ── Default: Serve Waitlist HTML page ──
  const htmlPath = path.join(__dirname, "..", "public", "waitlist.html");
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send("Waitlist page not found");
  }
  const html = fs.readFileSync(htmlPath, "utf8");
  const injected = html
    .replace("'REPLACE_WITH_YOUR_SUPABASE_URL'", `'${process.env.EXPO_PUBLIC_SUPABASE_URL || ""}'`)
    .replace("'REPLACE_WITH_YOUR_SUPABASE_ANON_KEY'", `'${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ""}'`);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(injected);
}

/**
 * Handle new waitlist submissions
 */
async function handleJoin(req, res) {
  const rawEmail = (req.body?.email || req.body?.p_email || "").trim().toLowerCase();
  if (!rawEmail || !EMAIL_RE.test(rawEmail)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({ error: "Database configuration unavailable." });
  }

  try {
    // Call Supabase RPC join_waitlist(p_email)
    const { data, error } = await supabase.rpc("join_waitlist", { p_email: rawEmail });
    if (error) {
      console.warn("[Waitlist] Supabase RPC error:", error);
      return res.status(500).json({ error: error.message || "Failed to join waitlist" });
    }

    const position = data?.position || null;
    const alreadyExists = !!data?.already_exists;

    // Send confirmation email asynchronously if it's a new signup
    if (!alreadyExists) {
      sendWaitlistEmail(supabase, rawEmail, position).catch(() => {});
    }

    return res.status(200).json({
      ok: true,
      already_exists: alreadyExists,
      position,
      show_position: !!data?.show_position,
      message: alreadyExists ? "You're already on the waitlist!" : "You've successfully joined the waitlist!",
    });
  } catch (err) {
    console.error("[Waitlist] Join error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Handle direct CSV export
 */
async function handleCsvExport(req, res) {
  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).send("Database connection unavailable");
  }

  try {
    const { data, error } = await supabase
      .from("waitlist")
      .select("id, email, position, created_at, notified")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).send(`Error fetching waitlist: ${error.message}`);
    }

    let csv = "Position,Email,Joined At,Confirmation Sent,ID\r\n";
    for (const row of data || []) {
      const date = row.created_at ? new Date(row.created_at).toISOString() : "";
      const notified = row.notified ? "Yes" : "No";
      csv += `${row.position || ""},"${(row.email || "").replace(/"/g, '""')}",${date},${notified},${row.id || ""}\r\n`;
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="networq-waitlist.csv"');
    return res.status(200).send(csv);
  } catch (err) {
    return res.status(500).send(`Export failed: ${err.message}`);
  }
}

/**
 * Render luxury visual Admin Dashboard
 */
async function handleDashboard(req, res) {
  const supabase = getSupabase();
  let rows = [];
  let errorMsg = "";

  if (supabase) {
    const { data, error } = await supabase
      .from("waitlist")
      .select("id, email, position, created_at, notified")
      .order("created_at", { ascending: false });
    if (error) errorMsg = error.message;
    else rows = data || [];
  } else {
    errorMsg = "Database service key not configured.";
  }

  const count = rows.length;
  const notifiedCount = rows.filter((r) => r.notified).length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NetworQ — Waitlist Dashboard</title>
  <style>
    :root {
      --bg: #0C0E1A;
      --card: #151828;
      --border: #262B45;
      --text: #F3F4F8;
      --muted: #8E95AA;
      --accent: #8B5CF6;
      --accent-glow: rgba(139, 92, 246, 0.25);
      --success: #10B981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; padding: 32px 20px; }
    .container { max-width: 980px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; flex-wrap: wrap; gap: 16px; }
    .brand { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; }
    .brand span { color: var(--accent); }
    .actions { display: flex; gap: 12px; }
    .btn { background: var(--accent); color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 10px; font-weight: 600; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; border: none; cursor: pointer; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.9; }
    .btn-secondary { background: var(--card); border: 1px solid var(--border); color: var(--text); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
    .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 20px; }
    .stat-label { font-size: 13px; color: var(--muted); font-weight: 500; margin-bottom: 6px; }
    .stat-val { font-size: 32px; font-weight: 800; color: #fff; letter-spacing: -0.03em; }
    .search-box { width: 100%; padding: 12px 16px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; color: #fff; font-size: 15px; margin-bottom: 18px; outline: none; }
    .table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: 14px; overflow-x: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
    th { padding: 14px 18px; background: rgba(255,255,255,0.03); color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); }
    td { padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.05); color: #D1D5DB; }
    tr:last-child td { border-bottom: none; }
    .pos-badge { background: rgba(139, 92, 246, 0.15); color: var(--accent); padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 13px; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 6px; }
    .status-sent { background: rgba(16, 185, 129, 0.15); color: #34D399; }
    .status-pending { background: rgba(245, 158, 11, 0.15); color: #FBBF24; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="brand">Networ<span>Q</span> <span style="font-size:14px;font-weight:500;color:var(--muted);margin-left:8px;">Waitlist Dashboard</span></div>
        <div style="font-size:13px;color:var(--muted);margin-top:4px;">Live signups from your landing page and domain</div>
      </div>
      <div class="actions">
        <a href="/api/waitlist/export.csv" class="btn">⬇️ Download CSV (Google Sheets)</a>
        <a href="https://supabase.com/dashboard/project/jpuxmkkuzqojqeatespa/editor" target="_blank" rel="noopener" class="btn btn-secondary">⚡ Open Supabase</a>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Signups</div>
        <div class="stat-val">${count}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Confirmation Emails Sent</div>
        <div class="stat-val" style="color:#34D399;">${notifiedCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Database Sync</div>
        <div class="stat-val" style="font-size:20px;color:${errorMsg ? "#EF4444" : "#34D399"};">${errorMsg ? "Error" : "Live & Active"}</div>
      </div>
    </div>

    <input type="text" id="search" class="search-box" placeholder="🔍 Search email or queue position..." onkeyup="filterTable()" />

    <div class="table-wrap">
      <table id="waitlist-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Email Address</th>
            <th>Date Joined</th>
            <th>Email Status</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length === 0
              ? `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--muted);">No waitlist signups yet. Fill the waitlist form to see live data!</td></tr>`
              : rows
                  .map((r) => {
                    const date = r.created_at ? new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—";
                    return `<tr>
                      <td><span class="pos-badge">#${r.position || "—"}</span></td>
                      <td style="font-weight:600;color:#fff;">${r.email || "—"}</td>
                      <td style="color:var(--muted);font-size:13px;">${date} IST</td>
                      <td>
                        ${
                          r.notified
                            ? `<span class="status-badge status-sent">✓ Sent</span>`
                            : `<span class="status-badge status-pending">⏳ In Queue</span>`
                        }
                      </td>
                    </tr>`;
                  })
                  .join("")
          }
        </tbody>
      </table>
    </div>
  </div>

  <script>
    function filterTable() {
      const q = document.getElementById('search').value.toLowerCase();
      const trs = document.querySelectorAll('#waitlist-table tbody tr');
      trs.forEach(tr => {
        const text = tr.innerText.toLowerCase();
        tr.style.display = text.includes(q) ? '' : 'none';
      });
    }
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
