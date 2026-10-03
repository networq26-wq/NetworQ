/**
 * Database → server hook: emails for connection requests/acceptances.
 * The notifications_dispatch trigger (pg_net) posts { notification_id } with a shared
 * secret; all content is read back from the database, never from the request.
 */
const crypto = require("crypto");
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const emails = require("./_lib/emails");
const { linkSecret } = require("./_lib/signedLink");
const { sendTransactional } = require("./_lib/mailer");

function hookSecret(base = linkSecret()) {
  return base ? crypto.createHash("sha256").update(`notify-hook:${base}`).digest("hex") : null;
}

function createNotifyHookRouter(deps) {
  const router = express.Router();
  router.post("/hooks/notification", async (req, res) => {
    const given = String(req.headers["x-networq-hook"] || "");
    const ok = deps.secret && given.length === deps.secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(deps.secret));
    if (!ok) return res.status(401).json({ error: "unauthorized" });
    const id = req.body?.notification_id;
    if (typeof id !== "string") return res.status(400).json({ error: "notification_id required" });

    const n = await deps.loadNotification(id);
    if (!n) return res.status(404).json({ error: "not found" });
    if (n.emailed_at) return res.json({ ok: true, skipped: "already emailed" });
    if (!["connection_request", "connection_accepted"].includes(n.type)) return res.json({ ok: true, skipped: "type" });

    const recipient = await deps.loadPerson(n.user_id);
    if (!recipient?.email) return res.json({ ok: true, skipped: "no email" });
    if (recipient.notification_prefs?.connection_emails === false) return res.json({ ok: true, skipped: "opted out" });
    const other = n.data?.from_user ? await deps.loadPerson(n.data.from_user) : null;
    const eventName = n.data?.event_id ? await deps.loadEventName(n.data.event_id) : null;

    const tpl =
      n.type === "connection_request"
        ? emails.connectionRequest({ name: recipient.name, fromName: other?.name || "A NetworQ member", fromTitle: other?.role, eventName, appUrl: deps.appUrl })
        : emails.connectionAccepted({ name: recipient.name, otherName: other?.name || "Your connection", otherTitle: other?.role, eventName, appUrl: deps.appUrl });
    const { subject, html, text } = await emails.render(tpl);
    await deps.send({ to: recipient.email, subject, html, text });
    await deps.markEmailed(id);
    res.json({ ok: true, sent: n.type });
  });
  return router;
}

function productionDeps() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = hookSecret();
  if (!url || !key || !secret) return null;
  const admin = createClient(url, key, { auth: { persistSession: false } });
  return {
    secret,
    appUrl: process.env.PUBLIC_APP_URL || "https://www.networq.co.in",
    async loadNotification(id) {
      const { data } = await admin.from("notifications").select("*").eq("id", id).maybeSingle();
      return data;
    },
    async loadPerson(userId) {
      const [{ data: profile }, { data: u }] = await Promise.all([
        admin.from("profiles").select("name, role, notification_prefs").eq("id", userId).maybeSingle(),
        admin.auth.admin.getUserById(userId),
      ]);
      return { ...(profile || {}), email: u?.user?.email };
    },
    async loadEventName(id) {
      const { data } = await admin.from("events").select("name").eq("id", id).maybeSingle();
      return data?.name || null;
    },
    async markEmailed(id) {
      await admin.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", id);
    },
    send: sendTransactional,
  };
}

module.exports = { createNotifyHookRouter, productionDeps, hookSecret };
