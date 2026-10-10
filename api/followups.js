// Follow-up autopilot: once a user turns it on, NetworQ writes and sends their follow-up emails
// to the people they met — by default 1, 7 and 30 days after adding the contact.
//   • sent as "<User> via NetworQ" from our address, Reply-To the user, so replies land in their inbox
//   • every email has a one-click unsubscribe; unsubscribed addresses are never emailed again
//   • each step is "claimed" before sending, so two server instances can't send the same email
//   • limits: 25 autopilot emails per user per day, 40 per run; failures retry later, 3 strikes pauses
//   • we can't see the contact's inbox, so the sequence stops when the user marks "Replied",
//     pauses it, or it finishes after the last step
const { sign, verify, linkSecret } = require("./_lib/signedLink");
const { buildGroqRequestBody, extractGroqText, FALLBACK_MODEL } = require("./_lib/groq");

const DAY = 24 * 3600 * 1000;
const PER_USER_DAILY = 25;
const PER_RUN = 40;
const MAX_FAILURES = 3;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";

function stepKind(index, total) {
  if (index === 0) return "first";
  if (index === total - 1) return "last";
  return "middle";
}

// Plain fallback when AI isn't available — short, specific, no placeholders left in
function templateEmail({ user, contact, index, total }) {
  const them = firstName(contact.name) || "there";
  const me = firstName(user.name) || user.name || "";
  const where = contact.event ? ` at ${contact.event}` : "";
  const kind = stepKind(index, total);
  if (kind === "first")
    return {
      subject: `Great meeting you${contact.event ? ` at ${contact.event}` : ""}`,
      body: `Hi ${them},\n\nIt was great meeting you${where}. I enjoyed our conversation${contact.reference ? ` about ${contact.reference}` : ""} and would love to stay in touch.\n\nIf it would help to continue the conversation, just reply here and we can find a time.\n\nBest,\n${me}`,
    };
  if (kind === "middle")
    return {
      subject: `Following up${contact.company ? ` — ${contact.company}` : ""}`,
      body: `Hi ${them},\n\nJust following up on our conversation${where}. Is there anything I can help with, or a good time to catch up for 15 minutes?\n\nBest,\n${me}`,
    };
  return {
    subject: `Staying in touch`,
    body: `Hi ${them},\n\nIt's been a few weeks since we met${where}, so I wanted to check in. How are things going${contact.company ? ` at ${contact.company}` : ""}? I'd be glad to reconnect whenever it suits you.\n\nBest,\n${me}`,
  };
}

// AI-written version (Groq), using only what the user saved about this contact. Falls back to the template.
async function writeEmail({ user, contact, index, total, fetchImpl = fetch }) {
  const fallback = templateEmail({ user, contact, index, total });
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ...fallback, ai: false };
  const kind = { first: "a warm next-day follow-up after meeting", middle: "a short, friendly one-week check-in", last: "a light one-month reconnect" }[stepKind(index, total)];
  const facts = [
    `Sender: ${user.name}${user.role ? `, ${user.role}` : ""}${user.company ? ` at ${user.company}` : ""}`,
    `Recipient: ${contact.name}${contact.title ? `, ${contact.title}` : ""}${contact.company ? ` at ${contact.company}` : ""}`,
    contact.event ? `Where they met: ${contact.event}` : "",
    contact.reference ? `What they talked about / notes: ${String(contact.reference).slice(0, 600)}` : "",
    index > 0 ? `This is follow-up ${index + 1} of ${total}; earlier emails got no reply that we know of.` : "",
  ].filter(Boolean).join("\n");
  const system =
    "You write short, warm, professional follow-up emails on behalf of the sender. Write as the sender, in plain text, 50–110 words. " +
    "Use only the facts given — never invent meetings, numbers, companies or promises. No placeholders like [Name], no emojis, no hashtags. " +
    "End with one simple, low-pressure next step and sign off with the sender's first name. " +
    'Reply ONLY with JSON: {"subject": "...", "body": "..."}. Subject under 60 characters.';
  try {
    const body = buildGroqRequestBody({ system, messages: [{ role: "user", content: `Write ${kind}.\n\n${facts}` }], max_tokens: 400, action: "email_generation" });
    const call = (b) => fetchImpl("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(b) });
    let res = await call(body);
    if (!res.ok) res = await call({ ...body, model: FALLBACK_MODEL });
    if (!res.ok) return { ...fallback, ai: false };
    const raw = extractGroqText(await res.json()).replace(/<think>[\s\S]*?<\/think>/g, "");
    const json = JSON.parse((/\{[\s\S]*\}/.exec(raw) || ["{}"])[0]);
    const subject = String(json.subject || "").replace(/[\r\n]/g, " ").trim().slice(0, 90);
    const text = String(json.body || "").trim();
    if (!subject || text.length < 30 || /\[[^\]]+\]/.test(text)) return { ...fallback, ai: false };
    return { subject, body: text.slice(0, 2000), ai: true };
  } catch {
    return { ...fallback, ai: false };
  }
}

function unsubscribeUrl(appUrl, email, contactId) {
  const secret = linkSecret();
  if (!secret) return null;
  return `${appUrl}/api/followups/unsubscribe?t=${encodeURIComponent(sign({ a: "followup_unsub", e: String(email).toLowerCase(), c: contactId }, 400 * 24 * 3600, secret))}`;
}

function emailHtml(body, { user, unsubUrl }) {
  const paras = String(body).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.55">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;color:#1c1c1e;max-width:560px">${paras}
<p style="margin:28px 0 0;font-size:12px;color:#8e8e93">Sent by ${esc(user.name)} with NetworQ.${unsubUrl ? ` <a href="${esc(unsubUrl)}" style="color:#8e8e93">Unsubscribe</a>` : ""}</p></div>`;
}

const withSignature = (body, sig) => (sig ? `${body}\n\n${sig}` : body);

/**
 * One pass of the autopilot. deps: { supabase (service role), mailer, appUrl, now?, fetchImpl? }
 * Returns { sent, failed, skipped, stopped }.
 */
async function runFollowups(deps) {
  const { supabase, mailer, appUrl } = deps;
  const now = deps.now || new Date();
  const out = { sent: 0, failed: 0, skipped: 0, stopped: 0 };

  const { data: due, error } = await supabase
    .from("contacts")
    .select("id, user_id, name, title, company, email, event, reference, added_at, autopilot_step, autopilot_next_at, autopilot_status")
    .eq("autopilot_status", "active")
    .not("email", "is", null)
    .lte("autopilot_next_at", now.toISOString())
    .order("autopilot_next_at", { ascending: true })
    .limit(200);
  if (error || !due?.length) return out;

  const userIds = [...new Set(due.map((c) => c.user_id))];
  const { data: profiles } = await supabase.from("profiles").select("id, name, role, company, autopilot_enabled, autopilot_days, autopilot_signature").in("id", userIds).eq("autopilot_enabled", true);
  const users = new Map((profiles || []).map((p) => [p.id, p]));
  if (!users.size) return out;

  const emails = [...new Set(due.map((c) => String(c.email).toLowerCase()))];
  const { data: optouts } = await supabase.from("followup_optouts").select("email").in("email", emails);
  const optedOut = new Set((optouts || []).map((o) => o.email));

  const dayStart = new Date(now.getTime() - DAY).toISOString();
  const sentToday = new Map();
  const { data: recent } = await supabase.from("followup_log").select("user_id").in("user_id", [...users.keys()]).eq("status", "sent").gte("created_at", dayStart);
  for (const r of recent || []) sentToday.set(r.user_id, (sentToday.get(r.user_id) || 0) + 1);

  const replyTo = new Map();
  const userEmail = async (id) => {
    if (!replyTo.has(id)) {
      const { data } = await supabase.auth.admin.getUserById(id).catch(() => ({ data: null }));
      replyTo.set(id, data?.user?.email || null);
    }
    return replyTo.get(id);
  };
  const log = (row) => supabase.from("followup_log").insert(row).then(() => {}, () => {});

  for (const c of due) {
    if (out.sent + out.failed >= PER_RUN) break;
    const user = users.get(c.user_id);
    if (!user) continue; // autopilot off for this user: leave it scheduled
    const days = Array.isArray(user.autopilot_days) && user.autopilot_days.length ? user.autopilot_days : [1, 7, 30];
    const step = c.autopilot_step || 0;
    const to = String(c.email).toLowerCase().trim();

    if (step >= days.length) {
      await supabase.from("contacts").update({ autopilot_status: "done", autopilot_next_at: null }).eq("id", c.id);
      out.stopped++;
      continue;
    }
    if (optedOut.has(to) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      await supabase.from("contacts").update({ autopilot_status: "opted_out", autopilot_next_at: null }).eq("id", c.id);
      await log({ user_id: c.user_id, contact_id: c.id, step: step + 1, to_email: to, status: "skipped", error: optedOut.has(to) ? "unsubscribed" : "invalid email" });
      out.skipped++;
      continue;
    }
    if ((sentToday.get(c.user_id) || 0) >= PER_USER_DAILY) continue; // tomorrow

    // Claim this step (another instance may be running)
    const { data: claimed } = await supabase
      .from("contacts")
      .update({ autopilot_next_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString() })
      .eq("id", c.id)
      .eq("autopilot_step", step)
      .eq("autopilot_status", "active")
      .eq("autopilot_next_at", c.autopilot_next_at)
      .select("id");
    if (!claimed?.length) continue;

    const reply = await userEmail(c.user_id);
    const draft = await writeEmail({ user, contact: c, index: step, total: days.length, fetchImpl: deps.fetchImpl });
    const text = withSignature(draft.body, user.autopilot_signature);
    const unsub = unsubscribeUrl(appUrl, to, c.id);
    try {
      await mailer({
        to,
        subject: draft.subject,
        text: unsub ? `${text}\n\n—\nUnsubscribe: ${unsub}` : text,
        html: emailHtml(text, { user, unsubUrl: unsub }),
        fromName: `${user.name || "A NetworQ user"} via NetworQ`,
        replyTo: reply || undefined,
        headers: unsub ? { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
      });
      const nextIndex = step + 1;
      const finished = nextIndex >= days.length;
      const added = new Date(c.added_at || now).getTime();
      const nextAt = finished ? null : new Date(Math.max(added + days[nextIndex] * DAY, now.getTime() + DAY)).toISOString();
      await supabase.from("contacts").update({ autopilot_step: nextIndex, autopilot_last_sent_at: now.toISOString(), autopilot_next_at: nextAt, autopilot_status: finished ? "done" : "active", email_sent: true }).eq("id", c.id);
      await log({ user_id: c.user_id, contact_id: c.id, step: nextIndex, to_email: to, subject: draft.subject, body: text, status: "sent" });
      sentToday.set(c.user_id, (sentToday.get(c.user_id) || 0) + 1);
      out.sent++;
    } catch (err) {
      const { count } = await supabase.from("followup_log").select("id", { count: "exact", head: true }).eq("contact_id", c.id).eq("step", step + 1).eq("status", "failed");
      const strikes = (count || 0) + 1;
      await supabase.from("contacts").update(strikes >= MAX_FAILURES ? { autopilot_status: "paused" } : { autopilot_next_at: new Date(now.getTime() + 6 * 3600 * 1000).toISOString() }).eq("id", c.id);
      await log({ user_id: c.user_id, contact_id: c.id, step: step + 1, to_email: to, subject: draft.subject, status: "failed", error: String(err.message || err).slice(0, 300) });
      out.failed++;
    }
  }
  return out;
}

function startFollowupEngine({ supabase, mailer, appUrl, everyMs = 10 * 60 * 1000 }) {
  const tick = () => runFollowups({ supabase, mailer, appUrl }).then((r) => (r.sent || r.failed) && console.log("[Autopilot]", JSON.stringify(r))).catch((e) => console.warn("[Autopilot] error:", e.message));
  setTimeout(tick, 30 * 1000);
  return setInterval(tick, everyMs);
}

// ── HTTP: unsubscribe (public, signed link) + preview for signed-in users ────
function createFollowupsRouter({ express, supabase, getUser, appUrl }) {
  const router = express.Router();
  const page = (title, msg, form = "") =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f3f3f5;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}main{background:#fff;border:1px solid #ddd;border-radius:18px;padding:28px;max-width:420px;width:100%}h1{font-size:20px;margin:0 0 8px}p{color:#555;line-height:1.5}button{width:100%;height:48px;border:0;border-radius:12px;background:#4B3BEA;color:#fff;font-size:16px;font-weight:600;cursor:pointer;margin-top:12px}</style></head>
<body><main><img src="/brand/networq-wordmark.png" alt="NetworQ" style="height:24px;margin-bottom:18px"><h1>${esc(title)}</h1><p>${msg}</p>${form}</main></body></html>`;

  router.get("/followups/unsubscribe", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const p = verify(String(req.query.t || ""), "followup_unsub", linkSecret() || "");
    if (!p) return res.status(400).type("html").send(page("Link expired", "This unsubscribe link isn't valid any more. Reply to the email and ask the sender to stop, and they will."));
    return res.type("html").send(page("Stop these emails?", `You won't get any more automatic follow-up emails sent through NetworQ at <b>${esc(p.e)}</b>.`, `<form method="post"><input type="hidden" name="t" value="${esc(req.query.t)}"><button type="submit">Unsubscribe</button></form>`));
  });

  router.post("/followups/unsubscribe", express.urlencoded({ extended: false, limit: "4kb" }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const token = String(req.query.t || req.body?.t || "");
    const p = verify(token, "followup_unsub", linkSecret() || "");
    if (!p) return res.status(400).type("html").send(page("Link expired", "This unsubscribe link isn't valid any more."));
    await supabase.from("followup_optouts").upsert({ email: p.e }, { onConflict: "email" });
    await supabase.from("contacts").update({ autopilot_status: "opted_out", autopilot_next_at: null }).ilike("email", p.e.replace(/[\\%_]/g, (m) => `\\${m}`)); // exact match, case-insensitive
    return res.type("html").send(page("You're unsubscribed", `We won't send any more automatic follow-ups to <b>${esc(p.e)}</b>.`));
  });

  // Signed-in user: see what the autopilot would send to one of their contacts (nothing is sent)
  router.post("/followups/preview", express.json({ limit: "8kb" }), async (req, res) => {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const userId = await getUser(token).catch(() => null);
    if (!userId) return res.status(401).json({ error: "Please sign in again." });
    const { data: user } = await supabase.from("profiles").select("name, role, company, autopilot_days, autopilot_signature").eq("id", userId).maybeSingle();
    let contact = null;
    if (req.body?.contact_id) {
      const { data } = await supabase.from("contacts").select("id, name, title, company, email, event, reference").eq("id", req.body.contact_id).eq("user_id", userId).maybeSingle();
      contact = data;
    }
    if (!contact) {
      const { data } = await supabase.from("contacts").select("id, name, title, company, email, event, reference").eq("user_id", userId).order("added_at", { ascending: false }).limit(1).maybeSingle();
      contact = data || { name: "Ravi Kumar", title: "CEO", company: "Kumar AI", event: "a startup meetup" };
    }
    const days = user?.autopilot_days?.length ? user.autopilot_days : [1, 7, 30];
    const index = Math.min(Math.max(0, parseInt(req.body?.step, 10) || 0), days.length - 1);
    const draft = await writeEmail({ user: { name: user?.name || "You", role: user?.role, company: user?.company }, contact, index, total: days.length });
    return res.json({ to: contact.name, subject: draft.subject, body: withSignature(draft.body, user?.autopilot_signature), ai: draft.ai, step: index + 1, day: days[index] });
  });
  return router;
}

module.exports = { runFollowups, startFollowupEngine, createFollowupsRouter, writeEmail, templateEmail, unsubscribeUrl, PER_USER_DAILY };
