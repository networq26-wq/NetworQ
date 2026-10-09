// Admin panel request handler — mounted under /waitlist/admin (and /api/waitlist/admin).
// All pages need a signed-in admin; all changes are POSTs from same-origin forms (SameSite=Strict
// cookie + Origin check) and are written to the activity log.
const A = require("./auth");
const V = require("./views");
const R = require("./reports");
const { healthSnapshot } = require("../_lib/health");
const { emailProvider } = require("../_lib/mailer");

const MAX_BULK = 200;
const MAX_INVITE = 50;

function securityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
}

const html = (res, status, body) => res.status(status).type("html").send(body);
const csvCell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
const ids = (body) => [].concat(body?.ids || []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, MAX_BULK);
const cleanTag = (t) => String(t || "").trim().toLowerCase().replace(/[^a-z0-9 _-]/g, "").slice(0, 40);
const parseTags = (s) => [...new Set(String(s || "").split(",").map(cleanTag).filter(Boolean))].slice(0, 20);

// POSTs must come from our own pages
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // older browsers / same-origin form posts without Origin
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * @param {object} deps { store, sendConfirmation(row) → {ok,error}, sendInvite(row) → {ok,error} }
 */
function createAdminHandler(deps) {
  const { store } = deps;

  async function audit(admin, action, target, details) {
    await store.audit({ admin: admin.username, action, target: target || null, details: details || null }).catch(() => {});
  }

  async function loadAll() {
    try {
      await store.syncJoined().catch(() => null);
      return { rows: await store.listSignups(), loadError: "" };
    } catch (e) {
      return { rows: [], loadError: `Couldn't load the waitlist: ${e.message}` };
    }
  }

  // Sends one email kind to rows; records results on each row
  async function sendTo(rows, kind) {
    let ok = 0;
    let failed = 0;
    for (const r of rows) {
      const res = await (kind === "invite" ? deps.sendInvite(r) : deps.sendConfirmation(r)).catch((e) => ({ ok: false, error: e.message }));
      const now = new Date().toISOString();
      if (res.ok) {
        ok++;
        await store.updateSignups([r.id], kind === "invite"
          ? { status: r.status === "joined" ? "joined" : "invited", invited_at: now, email_error: null, last_emailed_at: now }
          : { notified: true, email_error: null, last_emailed_at: now });
      } else {
        failed++;
        await store.updateSignups([r.id], { email_error: String(res.error || "send failed").slice(0, 300) });
      }
    }
    return { ok, failed };
  }

  return async function handle(req, res, sub, base) {
    securityHeaders(res);
    if (!A.owner()) return html(res, 404, V.offPage());

    // ── Sign in / out ──────────────────────────────────────────────────────
    if (sub === "/login" && req.method === "POST") {
      if (!sameOrigin(req)) return res.status(403).send("Forbidden");
      const admin = await A.login(req.body?.id, req.body?.password, store);
      if (!admin) {
        await store.audit({ admin: String(req.body?.id || "").slice(0, 40).toLowerCase() || "?", action: "login_failed", target: null, details: null }).catch(() => {});
        return html(res, 401, V.loginPage(base, "Wrong ID or password."));
      }
      A.setSession(req, res, admin);
      if (admin.id) await store.touchAdmin(admin.id).catch(() => {});
      await audit(admin, "login");
      return res.redirect(303, base);
    }
    if (sub === "/logout" && req.method === "POST") {
      const admin = await A.currentAdmin(req, store);
      if (admin) await audit(admin, "logout");
      A.clearSession(req, res);
      return res.redirect(303, base);
    }

    const admin = await A.currentAdmin(req, store);
    if (!admin) {
      if (sub === "/export.csv") {
        res.setHeader("WWW-Authenticate", 'Basic realm="NetworQ admin", charset="UTF-8"');
        return res.status(401).send("Log in at /waitlist/admin first.");
      }
      return html(res, req.method === "GET" && sub === "" ? 200 : 401, V.loginPage(base));
    }
    if (req.method === "POST" && !sameOrigin(req)) return res.status(403).send("Forbidden");
    const q = req.query || {};

    // ── Pages ──────────────────────────────────────────────────────────────
    if (req.method === "GET") {
      if (sub === "") {
        const { rows, loadError } = await loadAll();
        const needsMigration = !loadError && rows.length > 0 && !rows.some((r) => "status" in r);
        return html(res, 200, V.overviewPage({ base, admin, rows, query: q, loadError, needsMigration }));
      }
      if (sub === "/signups") {
        const { rows, loadError } = await loadAll();
        const filters = R.parseFilters(q);
        return html(res, 200, V.signupsPage({ base, admin, rows: R.filterRows(rows, filters), all: rows, filters, query: q, loadError }));
      }
      const person = /^\/person\/([0-9a-f-]{36})$/i.exec(sub);
      if (person) {
        const { rows } = await loadAll();
        const r = rows.find((x) => x.id === person[1]);
        if (!r) return res.redirect(303, `${base}/signups`);
        return html(res, 200, V.personPage({ base, admin, r, all: rows, query: q }));
      }
      if (sub === "/reports") {
        const { rows } = await loadAll();
        const filters = R.parseFilters({ range: q.range || "all" });
        return html(res, 200, V.reportsPage({ base, admin, rows: R.filterRows(rows, filters), filters, query: q }));
      }
      if (sub === "/app") {
        let stats = null;
        let error = "";
        try {
          stats = await store.appStats();
        } catch (e) {
          error = e.message;
        }
        return html(res, 200, V.appPage({ base, admin, stats, error, query: q }));
      }
      if (sub === "/health") {
        const { rows } = await loadAll();
        return html(res, 200, V.healthPage({ base, admin, health: healthSnapshot(), provider: emailProvider(), rows, query: q }));
      }
      if (sub === "/activity") {
        const entries = await store.listAudit(200).catch(() => []);
        return html(res, 200, V.activityPage({ base, admin, entries, query: q }));
      }
      if (sub === "/admins") {
        if (!admin.isOwner) return res.redirect(303, base);
        const admins = await store.listAdmins().catch(() => []);
        return html(res, 200, V.adminsPage({ base, admin, owner: A.owner().username, admins, query: q }));
      }
      if (sub === "/export.csv") {
        const { rows, loadError } = await loadAll();
        if (loadError) return res.status(503).send(loadError);
        const filters = R.parseFilters(q);
        const list = R.filterRows(rows, filters);
        const refs = R.referralCounts(rows);
        const header = ["Position", "Email", "Status", "Joined At (UTC)", "Confirmation Sent", "Invited At", "Joined App At", "Source", "Campaign", "Referrals", "Referred By Code", "Own Code", "Device", "Time Zone", "Tags", "Notes", "ID"];
        let csv = header.join(",") + "\r\n";
        for (const r of list) {
          csv += [r.position ?? "", r.email, r.status || "waiting", r.created_at ? new Date(r.created_at).toISOString() : "", r.notified ? "Yes" : "No", r.invited_at || "", r.joined_at || "",
            R.sourceOf(r), r.utm_campaign || "", refs.get(r.ref_code) || 0, r.referred_by || "", r.ref_code || "", r.device || "", r.timezone || "", (r.tags || []).join("; "), r.notes || "", r.id]
            .map(csvCell)
            .join(",") + "\r\n";
        }
        await audit(admin, "export", null, { rows: String(list.length) });
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="networq-waitlist.csv"');
        return res.status(200).send(csv);
      }
      return res.redirect(303, base);
    }

    // ── Actions ────────────────────────────────────────────────────────────
    if (req.method === "POST") {
      const b = req.body || {};
      if (sub === "/signups/bulk") {
        const backQs = String(b.back || "").replace(/[^A-Za-z0-9=&%._+-]/g, "").slice(0, 500);
        const back = `${base}/signups?${backQs ? `${backQs}&` : ""}`;
        const selected = ids(b);
        if (!selected.length) return res.redirect(303, `${back}msg=none`);
        const { rows } = await loadAll();
        const chosen = rows.filter((r) => selected.includes(r.id));
        const action = String(b.action || "");
        if (action === "invite" || action === "resend") {
          const r = await sendTo(chosen.slice(0, MAX_INVITE), action);
          await audit(admin, action, null, { people: chosen.slice(0, MAX_INVITE).map((x) => x.email), failed: String(r.failed) });
          return res.redirect(303, `${back}msg=${action === "invite" ? "invited" : "resent"}&n=${r.ok}&f=${r.failed}`);
        }
        if (action === "tag_add" || action === "tag_remove") {
          const tag = cleanTag(b.tag);
          if (!tag) return res.redirect(303, `${back}msg=none`);
          for (const r of chosen) {
            const set = new Set(r.tags || []);
            action === "tag_add" ? set.add(tag) : set.delete(tag);
            await store.updateSignups([r.id], { tags: [...set].slice(0, 20) });
          }
          await audit(admin, action, tag, { people: chosen.map((x) => x.email) });
          return res.redirect(303, `${back}msg=tagged&n=${chosen.length}`);
        }
        if (action === "status_waiting") {
          const done = await store.updateSignups(chosen.map((r) => r.id), { status: "waiting", invited_at: null });
          await audit(admin, action, null, { people: chosen.map((x) => x.email) });
          return res.redirect(303, `${back}msg=status&n=${done.length}`);
        }
        if (action === "delete") {
          if (b.confirm !== "DELETE") return res.redirect(303, `${back}msg=confirm`);
          const nDel = await store.deleteSignups(chosen.map((r) => r.id));
          await audit(admin, "delete", null, { people: chosen.map((x) => x.email) });
          return res.redirect(303, `${back}msg=deleted&n=${nDel}`);
        }
        return res.redirect(303, back);
      }

      if (sub === "/invite-next") {
        const count = Math.min(MAX_INVITE, Math.max(1, parseInt(b.n, 10) || 10));
        const { rows } = await loadAll();
        const next = R.priorityOrder(rows).slice(0, count);
        if (!next.length) return res.redirect(303, `${base}/signups?msg=nothing`);
        const r = await sendTo(next, "invite");
        await audit(admin, "invite_next", null, { people: next.map((x) => x.email), failed: String(r.failed) });
        return res.redirect(303, `${base}/signups?msg=invited&n=${r.ok}&f=${r.failed}`);
      }

      if (sub === "/retry-failed") {
        const { rows } = await loadAll();
        const failed = rows.filter((x) => !x.notified && x.email_error).slice(0, MAX_INVITE);
        const r = await sendTo(failed, "resend");
        await audit(admin, "retry_failed", null, { people: failed.map((x) => x.email), failed: String(r.failed) });
        return res.redirect(303, `${base}/reports?msg=resent&n=${r.ok}&f=${r.failed}#email`);
      }

      const person = /^\/person\/([0-9a-f-]{36})(\/action)?$/i.exec(sub);
      if (person) {
        const id = person[1];
        const r = await store.getSignup(id).catch(() => null);
        if (!r) return res.redirect(303, `${base}/signups`);
        const back = `${base}/person/${id}`;
        if (!person[2]) {
          await store.updateSignups([id], { notes: String(b.notes || "").slice(0, 4000) || null, tags: parseTags(b.tags) });
          await audit(admin, "notes", r.email);
          return res.redirect(303, `${back}?msg=saved`);
        }
        const action = String(b.action || "");
        if (action === "invite" || action === "resend") {
          const out = await sendTo([r], action);
          await audit(admin, action, r.email, { failed: String(out.failed) });
          return res.redirect(303, `${back}?msg=${action === "invite" ? "invited" : "resent"}&n=${out.ok}&f=${out.failed}`);
        }
        if (action === "delete") {
          if (b.confirm !== "DELETE") return res.redirect(303, `${back}?msg=confirm`);
          await store.deleteSignups([id]);
          await audit(admin, "delete", r.email);
          return res.redirect(303, `${base}/signups?msg=deleted&n=1`);
        }
        return res.redirect(303, back);
      }

      if (sub === "/admins" || /^\/admins\/[0-9a-f-]{36}$/i.test(sub)) {
        if (!admin.isOwner) return res.status(403).send("Only the owner can manage admins.");
        if (sub === "/admins") {
          const username = String(b.username || "").trim().toLowerCase();
          const problem = !A.USERNAME_RE.test(username)
            ? "Admin ID: 3–40 characters, lowercase letters, numbers, dot, dash or underscore."
            : username === A.owner().username
              ? "That ID is the owner's."
              : A.passwordProblem(b.password);
          if (problem) return res.redirect(303, `${base}/admins?msg=admin_error&e=${encodeURIComponent(problem)}`);
          try {
            await store.createAdmin({ username, password_hash: A.hashPassword(b.password), created_by: admin.username });
          } catch (e) {
            const msg = /duplicate|unique/i.test(e.message) ? "That Admin ID already exists." : "Couldn't add the admin.";
            return res.redirect(303, `${base}/admins?msg=admin_error&e=${encodeURIComponent(msg)}`);
          }
          await audit(admin, "admin_add", username);
          return res.redirect(303, `${base}/admins?msg=admin_added`);
        }
        const id = sub.split("/")[2];
        const disable = b.action !== "enable";
        await store.setAdminDisabled(id, disable);
        const target = (await store.listAdmins().catch(() => [])).find((a) => a.id === id);
        await audit(admin, disable ? "admin_disable" : "admin_enable", target?.username || id);
        return res.redirect(303, `${base}/admins?msg=admin_updated`);
      }
    }
    return res.status(404).send("Not found");
  };
}

module.exports = { createAdminHandler };
