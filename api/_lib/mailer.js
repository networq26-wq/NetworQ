// Transactional sender: Resend → SMTP → dev log. Never throws on dev fallback.
const { recordEmail } = require("./health");

function emailProvider() {
  if (process.env.RESEND_API_KEY) return { name: "resend", from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev" };
  if (process.env.SMTP_HOST) return { name: "smtp", from: process.env.SMTP_USER || "" };
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) return { name: "gmail", from: process.env.GMAIL_USER };
  return { name: "none", from: "" };
}

// Counts sends / failures for the admin Health page
async function sendTransactional(msg) {
  try {
    const r = await deliver(msg);
    if (r.provider !== "dev") recordEmail(true);
    return r;
  } catch (err) {
    recordEmail(false, { subject: msg.subject, error: err.message });
    throw err;
  }
}

// Optional: fromName (shown as the sender, e.g. "Asha Rao via NetworQ"), replyTo, extra headers
const bareAddress = (s) => (/<([^>]+)>/.exec(s || "") || [null, s || ""])[1].trim();
const cleanName = (s) => String(s || "").replace(/[\r\n"<>]/g, "").trim().slice(0, 80);

async function deliver({ to, subject, html, text, fromName, replyTo, headers }) {
  if (process.env.RESEND_API_KEY) {
    const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    const from = fromName ? `${cleanName(fromName)} <${bareAddress(fromEmail)}>` : /</.test(fromEmail) ? fromEmail : `NetworQ <${fromEmail}>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}), ...(headers ? { headers } : {}) }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d?.message || `Resend error ${res.status}`);
    }
    return { provider: "resend" };
  }
  if (process.env.SMTP_HOST || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)) {
    const nodemailer = require("nodemailer");
    const transporter = process.env.SMTP_HOST
      ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || "587"), secure: process.env.SMTP_SECURE === "true", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
      : nodemailer.createTransport({ service: "gmail", auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
    await transporter.sendMail({ from: `"${cleanName(fromName) || "NetworQ"}" <${process.env.GMAIL_USER || process.env.SMTP_USER}>`, to, subject, html, text, ...(replyTo ? { replyTo } : {}), ...(headers ? { headers } : {}) });
    return { provider: "smtp" };
  }
  console.log(`[Email:dev] To ${to} — ${subject}`);
  return { provider: "dev" };
}

module.exports = { sendTransactional, emailProvider };
