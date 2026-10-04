#!/usr/bin/env node
// One-shot production setup for NetworQ's Supabase project via the Management API.
//
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/setup-supabase.mjs           # dry run (shows the plan)
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/setup-supabase.mjs --apply   # apply
//
// Applies pending migrations (all idempotent), configures custom SMTP through
// Resend, branded auth email templates and auth security settings.
// Token: https://supabase.com/dashboard/account/tokens
import { readFileSync, existsSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

if (existsSync(new URL(".env", root))) {
  for (const line of read(".env").split("\n")) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const ref = projectUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const resendKey = process.env.RESEND_API_KEY;
const appUrl = process.env.PUBLIC_APP_URL || "https://www.networq.co.in";
const senderEmail = (process.env.RESEND_FROM_EMAIL || "").match(/<(.+)>/)?.[1] || process.env.RESEND_FROM_EMAIL;

const problems = [];
if (!token) problems.push("SUPABASE_ACCESS_TOKEN is not set (create one at https://supabase.com/dashboard/account/tokens)");
if (!ref) problems.push("EXPO_PUBLIC_SUPABASE_URL is missing or not a supabase.co URL");
if (!resendKey) problems.push("RESEND_API_KEY is missing");
if (!senderEmail || !senderEmail.endsWith("@networq.co.in")) problems.push("RESEND_FROM_EMAIL must use the verified networq.co.in domain");
if (problems.length) {
  console.error("Cannot continue:\n - " + problems.join("\n - "));
  process.exit(1);
}

const api = async (method, path, body) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
};

const MIGRATIONS = [
  "20261001_security_hardening.sql",
  "20261001b_restore_waitlist_and_storage.sql",
  "20261002_event_radar.sql",
  "20261003_account_email_events.sql",
  "20261003b_avatars_storage.sql",
  "20261004_events_crawler.sql",
  "20261005_connections_dedupe.sql",
  "20261006_realtime_notifications.sql",
  "20261007_prospect_research.sql",
  "20261008_nearby_radar.sql",
  "20261009_events_categories.sql",
  "20261010_push_notifications.sql",
  "20261011_realtime_chat.sql",
  "20261012_chat_hardening.sql",
  "20261013_calls.sql",
  "20261014_release_hardening.sql",
];

const authConfig = {
  site_url: appUrl,
  uri_allow_list: `${appUrl},${appUrl}/**,https://networq.co.in/**`,
  password_min_length: 8,
  mailer_secure_email_change_enabled: true,
  security_update_password_require_reauthentication: false, // Settings verifies the current password itself
  smtp_host: "smtp.resend.com",
  smtp_port: "465",
  smtp_user: "resend",
  smtp_pass: resendKey,
  smtp_admin_email: senderEmail,
  smtp_sender_name: "NetworQ",
  rate_limit_email_sent: 100,
  mailer_subjects_confirmation: "Confirm your NetworQ email",
  mailer_templates_confirmation_content: read("supabase/templates/confirm-signup.html"),
  mailer_subjects_recovery: "Reset your NetworQ password",
  mailer_templates_recovery_content: read("supabase/templates/reset-password.html"),
  mailer_subjects_email_change: "Confirm your new NetworQ email",
  mailer_templates_email_change_content: read("supabase/templates/change-email.html"),
  mailer_subjects_magic_link: "Your NetworQ sign-in link",
  mailer_templates_magic_link_content: read("supabase/templates/magic-link.html"),
};

console.log(`Project: ${ref}   Mode: ${APPLY ? "APPLY" : "dry run (add --apply to execute)"}\n`);

// 1. Access check
const project = await api("GET", "").catch((e) => {
  console.error("Access check failed:", e.message);
  process.exit(1);
});
console.log(`✔ Access OK — project "${project.name}" (${project.region}, status ${project.status})`);

// 2. Migrations
for (const file of MIGRATIONS) {
  const sql = read(`supabase/migrations/${file}`);
  if (!APPLY) {
    console.log(`• would run migration ${file} (${sql.length} chars)`);
    continue;
  }
  await api("POST", "/database/query", { query: sql });
  console.log(`✔ migration ${file}`);
}

// 3. Auth email + security config
const current = await api("GET", "/config/auth");
// Merge redirect URLs — never drop entries the project already allows
const existing = String(current.uri_allow_list || "").split(",").map((u) => u.trim()).filter(Boolean);
authConfig.uri_allow_list = [...new Set([...existing, ...authConfig.uri_allow_list.split(",")])].join(",");
const changes = Object.keys(authConfig).filter((k) => String(current[k] ?? "") !== String(authConfig[k]));
const shown = changes.map((k) => (k === "smtp_pass" ? `${k}=<resend key>` : k.includes("templates") ? `${k}=<template>` : `${k}=${authConfig[k]}`));
if (!APPLY) {
  console.log(`• would update ${changes.length} auth settings:\n    ${shown.join("\n    ")}`);
} else if (changes.length) {
  await api("PATCH", "/config/auth", Object.fromEntries(changes.map((k) => [k, authConfig[k]])));
  console.log(`✔ auth config updated (${changes.length} settings: SMTP via Resend, branded templates, security)`);
} else {
  console.log("✔ auth config already up to date");
}

// 4. Verify the objects the app depends on now exist
if (APPLY) {
  const checks = await api("POST", "/database/query", {
    query: `select
      to_regprocedure('public.join_waitlist(text)') is not null as join_waitlist,
      to_regprocedure('public.resolve_radar_tokens(uuid,text[])') is not null as radar,
      to_regclass('public.public_events') is not null as public_events,
      to_regclass('public.login_devices') is not null as login_devices,
      exists(select 1 from storage.buckets where id = 'card-images') as card_bucket,
      exists(select 1 from storage.buckets where id = 'avatars') as avatar_bucket,
      not exists(select 1 from pg_policies where tablename = 'ai_usage' and cmd = 'UPDATE') as ai_quota_locked`,
  });
  const row = checks[0];
  for (const [k, v] of Object.entries(row)) console.log(`${v ? "✔" : "✖"} ${k}`);
  if (Object.values(row).some((v) => !v)) process.exit(1);
  console.log("\nDone. Next: run `npm run test:rls` (expect all live checks to pass).");
}
