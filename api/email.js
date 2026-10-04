/**
 * NetworQ Email Handler
 * Priority: Resend API → Nodemailer SMTP → Dev log
 * Resend: free 3k emails/month, sign up at resend.com (takes 2 min)
 */

const { verifyAndCheckLimit } = require("./_lib/verifyAndLimit");
const { createClient } = require("@supabase/supabase-js");

function getSupabase() {
  if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

// ── Resend HTTP API (no npm package needed) ───────────────────────────────────
async function sendViaResend({ to, subject, html, text, fromName, replyTo, ics }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");

  const fromEmail = process.env.RESEND_FROM_EMAIL || "NetworQ <noreply@networq.app>";
  const fromAddress = fromEmail.match(/<(.+)>/)?.[1] || fromEmail.trim();
  const from = fromName ? `${fromName} via NetworQ <${fromAddress}>` : fromEmail;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from, to, subject, html, text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      // Calendar invite: mail apps show it with Accept / Decline and add it to the calendar
      ...(ics ? { attachments: [{ filename: "invite.ics", content: Buffer.from(ics, "utf8").toString("base64"), content_type: "text/calendar; method=REQUEST; charset=UTF-8" }] } : {}),
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Resend error ${res.status}`);
  return data;
}

// ── Nodemailer SMTP fallback ──────────────────────────────────────────────────
async function sendViaSMTP({ to, subject, html, text, fromName, replyTo, ics }) {
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
    ...(replyTo ? { replyTo } : {}),
    ...(ics ? { icalEvent: { filename: "invite.ics", method: "REQUEST", content: ics } } : {}),
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
  const accessToken = (req.headers.authorization || "").replace("Bearer ", "").trim();
  if (!supabase && process.env.NODE_ENV === "production") {
    return res.status(500).json({ error: "Authentication is not configured on the server." });
  }
  let verify;
  try {
    verify = await verifyAndCheckLimit(supabase, { accessToken, action: "email_send" });
  } catch (err) {
    console.warn("[Email] Session verification failed:", err.message);
    return res.status(503).json({ error: "Could not verify your session. Please try again." });
  }
  if (!verify.ok) return res.status(verify.status).json({ error: verify.error });

  const { to, subject, body, from_name, reply_to, ics: rawIcs } = req.body || {};
  // Optional calendar invite (built by the app); only a well-formed single VEVENT is accepted
  let ics;
  if (rawIcs !== undefined && rawIcs !== null) {
    if (typeof rawIcs !== "string" || rawIcs.length > 8000 || !/^BEGIN:VCALENDAR\r?\n/.test(rawIcs) || !/END:VCALENDAR\s*$/.test(rawIcs) || (rawIcs.match(/BEGIN:VEVENT/g) || []).length !== 1) {
      return res.status(400).json({ error: "Invalid calendar invite." });
    }
    ics = rawIcs;
  }
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "Missing required fields: to, subject, body" });
  }
  if (typeof to !== "string" || !EMAIL_RE.test(to.trim())) {
    return res.status(400).json({ error: "Recipient must be a single valid email address." });
  }
  if (typeof subject !== "string" || subject.length > 300 || typeof body !== "string" || body.length > 20000) {
    return res.status(400).json({ error: "Subject or body is too long." });
  }
  const replyTo = typeof reply_to === "string" && EMAIL_RE.test(reply_to.trim()) ? reply_to.trim() : undefined;
  const fromName = typeof from_name === "string" ? from_name.replace(/[<>"\r\n]/g, "").slice(0, 80) : undefined;

  const html = buildHtml(body);

  // Try Resend first
  if (process.env.RESEND_API_KEY) {
    try {
      const data = await sendViaResend({ to: to.trim(), subject, html, text: body, fromName, replyTo, ics });
      return res.json({ ok: true, provider: "resend", id: data.id });
    } catch (err) {
      console.warn("[Email] Resend failed:", err.message, "— trying SMTP fallback");
    }
  }

  // Try SMTP fallback
  if (process.env.SMTP_HOST || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)) {
    try {
      await sendViaSMTP({ to: to.trim(), subject, html, text: body, fromName, replyTo, ics });
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

