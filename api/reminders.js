/**
 * NetworQ Reminder Engine
 * Checks Supabase for due contact reminders and sends email notifications.
 * Uses Resend API (free tier: 3k emails/month) or SMTP fallback.
 * Runs as a background loop inside server.js — no external cron needed.
 */

const { createClient } = require("@supabase/supabase-js");

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendReminderEmail({ to, contactName, reminderText, reminderDate }) {
  const safeName = escapeHtml(contactName);
  const safeText = escapeHtml(reminderText);
  const safeDate = reminderDate ? escapeHtml(reminderDate) : "";
  const apiKey = process.env.RESEND_API_KEY;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <div style="margin-bottom: 16px;"><span style="font-size: 22px; font-weight: 700; color: #7C3AED;">NetworQ</span></div>
      <h2 style="font-size: 20px; font-weight: 600; color: #1c1c1e; margin: 0 0 12px;">⏰ Reminder Due Today</h2>
      <div style="background: #f2f2f7; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px;">
        <p style="margin: 0 0 4px; font-size: 17px; font-weight: 600; color: #1c1c1e;">${safeName}</p>
        <p style="margin: 0; font-size: 15px; color: #3c3c43;">${safeText}</p>
        ${safeDate ? `<p style="margin: 8px 0 0; font-size: 13px; color: #8e8e93;">Due: ${safeDate}</p>` : ""}
      </div>
      <a href="https://www.networq.co.in" style="display: inline-block; background: #7C3AED; color: white; text-decoration: none; padding: 12px 24px; border-radius: 10px; font-weight: 600; font-size: 15px;">Open NetworQ →</a>
      <hr style="border: none; border-top: 1px solid #e5e5ea; margin: 24px 0;" />
      <p style="font-size: 12px; color: #8e8e93;">NetworQ — Professional Network Intelligence</p>
    </div>
  `;

  if (apiKey) {
    const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `NetworQ <${fromEmail}>`,
        to,
        subject: `⏰ NetworQ Reminder: ${contactName}`,
        html,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d?.message || `Resend error ${res.status}`);
    }
    return;
  }

  // SMTP fallback (Gmail App Password or custom SMTP)
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    const nodemailer = require("nodemailer");
    const t = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
    await t.sendMail({
      from: `"NetworQ" <${process.env.GMAIL_USER}>`,
      to,
      subject: `⏰ NetworQ Reminder: ${contactName}`,
      html,
    });
    return;
  }

  // Dev fallback — log only
  console.log(`[Reminders] 📋 DEV: Reminder for ${to} — ${contactName}: ${reminderText}`);
}

async function checkAndSendReminders() {
  const supabase = createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const today = new Date().toISOString().split("T")[0];

  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id, name, reminder, reminder_date, user_id, reminder_done")
    .lte("reminder_date", today)
    .eq("reminder_done", false)
    .not("reminder", "is", null);

  if (error) {
    console.warn("[Reminders] Supabase query error:", error.message);
    return;
  }

  if (!contacts || contacts.length === 0) return;
  console.log(`[Reminders] Found ${contacts.length} due reminder(s)`);

  for (const contact of contacts) {
    try {
      // In-app + push notification (the dedupe key makes hourly re-runs harmless)
      await supabase.from("notifications").insert({
        user_id: contact.user_id,
        type: "reminder",
        title: `Follow up with ${contact.name}`,
        body: contact.reminder || null,
        data: { screen: "contacts", contact_id: contact.id },
        dedupe_key: `reminder:${contact.id}:${contact.reminder_date}`,
      }).then(({ error: nErr }) => nErr && !/duplicate|unique/i.test(nErr.message) && console.warn("[Reminders] notification:", nErr.message));

      // Respect Settings → Notifications → Reminder emails
      const { data: prefsRow } = await supabase.from("profiles").select("notification_prefs").eq("id", contact.user_id).maybeSingle();
      if (prefsRow?.notification_prefs?.reminder_emails === false) {
        await supabase.from("contacts").update({ reminder_done: true }).eq("id", contact.id);
        continue;
      }

      const { data: authUser } = await supabase.auth.admin.getUserById(contact.user_id);
      const userEmail = authUser?.user?.email;
      if (!userEmail) continue;

      await sendReminderEmail({
        to: userEmail,
        contactName: contact.name,
        reminderText: contact.reminder || `Follow up with ${contact.name}`,
        reminderDate: contact.reminder_date,
      });

      console.log(`[Reminders] ✅ Sent reminder to ${userEmail} for ${contact.name}`);

      await supabase.from("contacts").update({ reminder_done: true }).eq("id", contact.id);
    } catch (err) {
      console.error(`[Reminders] ❌ Failed for ${contact.name}:`, err.message);
    }
  }
}

function startReminderEngine() {
  console.log("[Reminders] 🔔 Reminder engine started — checking every hour");
  checkAndSendReminders().catch(console.error);
  return setInterval(() => checkAndSendReminders().catch(console.error), 60 * 60 * 1000);
}

module.exports = { startReminderEngine, escapeHtml };

