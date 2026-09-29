/**
 * NetworQ Email Handler
 * Priority: Resend API → Nodemailer SMTP → Dev log
 * Resend: free 3k emails/month, sign up at resend.com (takes 2 min)
 */

const { verifyAndCheckLimit } = require("./_lib/verifyAndLimit");
const { createClient } = require("@supabase/supabase-js");

function getSupabase() {
  return createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── Resend HTTP API (no npm package needed) ───────────────────────────────────
async function sendViaResend({ to, subject, html, text, fromName }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");

  const fromEmail = process.env.RESEND_FROM_EMAIL || "NetworQ <noreply@networq.app>";
  const from = fromName ? `${fromName} via NetworQ <${fromEmail.match(/<(.+)>/)?.[1] || "noreply@networq.app"}>` : fromEmail;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Resend error ${res.status}`);
  return data;
}

// ── Nodemailer SMTP fallback ──────────────────────────────────────────────────
async function sendViaSMTP({ to, subject, html, text, fromName }) {
  const nodemailer = require("nodemailer");

  let transporter;
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } else if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  } else {
    throw new Error("No SMTP configured");
  }

  const fromEmail = process.env.GMAIL_USER || process.env.SMTP_USER;
  await transporter.sendMail({
    from: `"${fromName || "NetworQ"}" <${fromEmail}>`,
    to, subject, html, text,
  });
}

// ── HTML email template ───────────────────────────────────────────────────────
function buildHtml(body) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #fff;">
      <div style="margin-bottom: 20px;">
        <span style="font-size: 22px; font-weight: 700; color: #7C3AED;">NetworQ</span>
      </div>
      <div style="white-space: pre-wrap; font-size: 15px; line-height: 1.65; color: #1c1c1e;">${body.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</div>
      <hr style="border: none; border-top: 1px solid #e5e5ea; margin: 28px 0 16px;" />
      <p style="font-size: 12px; color: #8e8e93; margin: 0;">Sent via NetworQ — Professional Network Intelligence</p>
    </div>
  `;
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function emailHandler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const supabase = getSupabase();
  const accessToken = (req.headers.authorization || "").replace("Bearer ", "");
  const verify = await verifyAndCheckLimit(supabase, { accessToken, action: "email_send" });
  if (!verify.ok) return res.status(verify.status).json({ error: verify.error });

  const { to, subject, body, from_name } = req.body || {};
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "Missing required fields: to, subject, body" });
  }

  const html = buildHtml(body);

  // Try Resend first
  if (process.env.RESEND_API_KEY) {
    try {
      const data = await sendViaResend({ to, subject, html, text: body, fromName: from_name });
      return res.json({ ok: true, provider: "resend", id: data.id });
    } catch (err) {
      console.warn("[Email] Resend failed:", err.message, "— trying SMTP fallback");
    }
  }

  // Try SMTP fallback
  if (process.env.SMTP_HOST || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)) {
    try {
      await sendViaSMTP({ to, subject, html, text: body, fromName: from_name });
      return res.json({ ok: true, provider: "smtp" });
    } catch (err) {
      console.warn("[Email] SMTP failed:", err.message);
      return res.status(500).json({ error: "Email send failed: " + err.message });
    }
  }

  // Dev mode — no transport configured, just log
  console.log("\n📧 [DEV MODE — add RESEND_API_KEY to .env to send real emails]");
  console.log(`   To:      ${to}`);
  console.log(`   Subject: ${subject}`);
  console.log(`   Body:    ${body.substring(0, 120)}...`);
  return res.json({
    ok: true,
    provider: "dev",
    message: "Email logged. Add RESEND_API_KEY to .env to send real emails.",
  });
};

