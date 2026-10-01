/**
 * Account security endpoints: sign-in notifications, "secure my account",
 * password-changed notices and scheduled account deletion.
 * Dependencies are injected so the logic is testable without Supabase or email.
 */
const crypto = require("crypto");
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const emails = require("./_lib/emails");
const { sign, verify, linkSecret } = require("./_lib/signedLink");
const { sendTransactional } = require("./_lib/mailer");

const DELETION_GRACE_DAYS = 7;

function deviceHash(userId, userAgent, acceptLanguage) {
  return crypto.createHash("sha256").update(`${userId}|${userAgent || ""}|${acceptLanguage || ""}`).digest("hex");
}

function describeDevice(ua = "") {
  const browser = /\bwv\b|NetworQ/i.test(ua)
    ? "NetworQ app"
    : /Edg\//.test(ua)
      ? "Edge"
      : /OPR\//.test(ua)
        ? "Opera"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "A browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "an unknown device";
  return `${browser} on ${os}`;
}

const formatWhen = (d = new Date()) =>
  d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata", timeZoneName: "short" });

const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · NetworQ</title><link rel="stylesheet" href="/legal/_style.css"></head><body><main><a class="brand" href="/">Networ<span>Q</span></a><div class="card"><h1>${title}</h1><p>${body}</p><nav><a href="/">Open NetworQ</a></nav></div></main></body></html>`;

function createAccountRouter(deps) {
  const router = express.Router();
  const bearer = (req) => (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();

  async function requireUser(req, res) {
    const token = bearer(req);
    const user = token ? await deps.getUser(token).catch(() => null) : null;
    if (!user) {
      res.status(401).json({ error: "Please sign in again." });
      return null;
    }
    return user;
  }

  async function mail(to, tpl) {
    try {
      const { subject, html, text } = await emails.render(tpl);
      await deps.send({ to, subject, html, text });
    } catch (err) {
      console.error("[Account] email failed:", err.message);
    }
  }

  const link = (path, payload, ttl) => `${deps.appUrl}/api/account/${path}?t=${encodeURIComponent(sign(payload, ttl, deps.secret))}`;

  // ── Sign-in & security events reported by the signed-in client ─────────────
  router.post("/auth/session-event", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const type = req.body?.type;
    if (!["signed_in", "password_changed"].includes(type)) return res.status(400).json({ error: "Unknown event." });

    const profile = (await deps.store.getProfile(user.id)) || {};
    const ua = String(req.headers["user-agent"] || "").slice(0, 300);

    if (type === "password_changed") {
      await mail(user.email, emails.passwordChanged({ name: profile.name, when: formatWhen(), secureUrl: link("secure", { u: user.id, a: "secure" }, 86400), appUrl: deps.appUrl }));
      return res.json({ ok: true });
    }

    const hash = deviceHash(user.id, ua, req.headers["accept-language"]);
    const devices = await deps.store.listDevices(user.id);
    const firstLogin = devices.length === 0;
    const newDevice = !firstLogin && !devices.some((d) => d.device_hash === hash);
    await deps.store.upsertDevice(user.id, hash, ua);

    if (firstLogin) {
      const providers = user.app_metadata?.providers || [];
      let setPasswordUrl = null;
      if (providers.length && !providers.includes("email") && deps.store.passwordSetupLink) {
        setPasswordUrl = await deps.store.passwordSetupLink(user.email).catch((err) => {
          console.warn("[Account] password setup link failed:", err.message);
          return null;
        });
      }
      await mail(user.email, emails.welcome({ name: profile.name, appUrl: deps.appUrl, setPasswordUrl }));
    } else if (newDevice && profile.notification_prefs?.login_alerts !== false) {
      const city = req.headers["cf-ipcity"] || req.headers["x-vercel-ip-city"];
      await mail(
        user.email,
        emails.newSignIn({
          name: profile.name,
          device: describeDevice(ua),
          when: formatWhen(),
          city: city ? decodeURIComponent(String(city)) : null,
          secureUrl: link("secure", { u: user.id, a: "secure" }, 86400),
          appUrl: deps.appUrl,
        })
      );
    }
    res.json({ ok: true, first_login: firstLogin, new_device: newDevice });
  });

  // ── "This wasn't me": sign out everywhere + password reset email ───────────
  router.get("/account/secure", async (req, res) => {
    const payload = verify(String(req.query.t || ""), "secure", deps.secret);
    if (!payload) return res.status(400).send(page("Link expired", "This security link is invalid or has expired. Sign in and use Settings → Security, or reset your password from the sign-in screen."));
    await deps.store.revokeSessions(payload.u);
    const email = await deps.store.getEmail(payload.u);
    if (email) await deps.store.sendPasswordReset(email);
    res.send(page("Account secured", "We've signed your account out of every device. Check your inbox for a link to set a new password."));
  });

  // ── Account deletion (7-day grace) ─────────────────────────────────────────
  router.post("/account/delete", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    if (req.body?.confirm !== "DELETE") return res.status(400).json({ error: "Type DELETE to confirm." });
    const at = new Date(Date.now() + DELETION_GRACE_DAYS * 86400000);
    await deps.store.setDeletion(user.id, at.toISOString());
    await deps.store.revokeSessions(user.id);
    const profile = (await deps.store.getProfile(user.id)) || {};
    await mail(
      user.email,
      emails.deletionScheduled({
        name: profile.name,
        date: at.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
        cancelUrl: link("cancel-deletion", { u: user.id, a: "cancel_delete" }, DELETION_GRACE_DAYS * 86400),
        appUrl: deps.appUrl,
      })
    );
    res.json({ ok: true, scheduled_for: at.toISOString() });
  });

  router.post("/account/cancel-deletion", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    await deps.store.setDeletion(user.id, null);
    res.json({ ok: true });
  });

  router.get("/account/cancel-deletion", async (req, res) => {
    const payload = verify(String(req.query.t || ""), "cancel_delete", deps.secret);
    if (!payload) return res.status(400).send(page("Link expired", "This link is invalid or has expired. Sign in to NetworQ to manage your account."));
    await deps.store.setDeletion(payload.u, null);
    res.send(page("Deletion cancelled", "Your NetworQ account will not be deleted. Sign in to continue where you left off."));
  });

  return router;
}

// ── Production wiring (Supabase + Resend) ─────────────────────────────────────
function productionDeps() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const secret = linkSecret();
  if (!url || !serviceKey || !anonKey || !secret) return null;
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, serviceKey, opts);
  const anon = createClient(url, anonKey, opts);
  const must = ({ error, data }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    secret,
    appUrl: process.env.PUBLIC_APP_URL || "https://www.networq.co.in",
    async getUser(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error ? null : data.user;
    },
    store: {
      listDevices: async (userId) => must(await admin.from("login_devices").select("device_hash").eq("user_id", userId)),
      upsertDevice: async (userId, hash, ua) =>
        must(await admin.from("login_devices").upsert({ user_id: userId, device_hash: hash, user_agent: ua, last_seen: new Date().toISOString() }, { onConflict: "user_id,device_hash" })),
      getProfile: async (userId) => must(await admin.from("profiles").select("name, notification_prefs, deletion_scheduled_at").eq("id", userId).maybeSingle()),
      setDeletion: async (userId, at) => must(await admin.from("profiles").update({ deletion_scheduled_at: at }).eq("id", userId)),
      revokeSessions: async (userId) => must(await admin.rpc("revoke_all_sessions", { p_user_id: userId })),
      getEmail: async (userId) => must(await admin.auth.admin.getUserById(userId)).user?.email,
      passwordSetupLink: async (email) => {
        const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: process.env.PUBLIC_APP_URL || "https://www.networq.co.in" } });
        if (error) throw new Error(error.message);
        return data.properties.action_link;
      },
      sendPasswordReset: async (email) => must(await anon.auth.resetPasswordForEmail(email, { redirectTo: process.env.PUBLIC_APP_URL || "https://www.networq.co.in" })),
    },
    send: sendTransactional,
  };
}

// Hourly: permanently delete accounts whose grace period ended (cascades to all data)
async function purgeDeletedAccounts() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return 0;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.from("profiles").select("id").lte("deletion_scheduled_at", new Date().toISOString());
  if (error) {
    console.warn("[Account] purge query failed:", error.message);
    return 0;
  }
  let n = 0;
  for (const { id } of data || []) {
    const { error: delErr } = await admin.auth.admin.deleteUser(id);
    if (delErr) console.error(`[Account] could not delete ${id}:`, delErr.message);
    else n++;
  }
  if (n) console.log(`[Account] permanently deleted ${n} account(s)`);
  return n;
}

module.exports = { createAccountRouter, productionDeps, purgeDeletedAccounts, deviceHash, describeDevice };
