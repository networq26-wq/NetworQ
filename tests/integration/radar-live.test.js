// Live Event Radar rules against a real Supabase project (opt-in: npm run test:rls).
// Skips automatically until supabase/migrations/20261002_event_radar.sql is applied.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const envPath = path.join(__dirname, "../../.env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
  });
}
const URL_ = process.env.QA_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.QA_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.QA_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const password = `QaRadar!${Date.now()}x`;

test.describe("Event Radar (live)", { skip: process.env.QA_LIVE_SUPABASE !== "1" && "set QA_LIVE_SUPABASE=1 to run" }, () => {
  let admin, a, b, outsider, ev, migrated = true;
  const ids = [];

  const user = async (tag) => {
    const { data, error } = await admin.auth.admin.createUser({ email: `qa-radar-${tag}-${Date.now()}@example.com`, password, email_confirm: true });
    if (error) throw error;
    ids.push(data.user.id);
    await admin.from("profiles").upsert({ id: data.user.id, name: `QA ${tag}`, company: "QA Co", role: "Tester" });
    const c = createClient(URL_, ANON, opts);
    await c.auth.signInWithPassword({ email: data.user.email, password });
    return { id: data.user.id, c };
  };

  test.before(async () => {
    admin = createClient(URL_, SERVICE, opts);
    a = await user("a");
    const probe = await a.c.rpc("my_events");
    if (probe.error && /function|schema cache/i.test(probe.error.message)) {
      migrated = false;
      return;
    }
    b = await user("b");
    outsider = await user("x");
    ev = (await a.c.rpc("create_event", { p_name: "QA Radar Night" })).data;
    await b.c.rpc("join_event_by_code", { p_code: ev.join_code });
  });

  test.after(async () => {
    if (ev) await admin.from("events").delete().eq("id", ev.id);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  });

  test("migration is applied", (t) => {
    if (!migrated) t.skip("20261002_event_radar.sql not applied yet");
  });

  test("same-event members resolve each other's tokens; outsiders cannot", async (t) => {
    if (!migrated) return t.skip("migration not applied");
    const tok = (await b.c.rpc("issue_radar_token", { p_event_id: ev.id })).data.token;
    const seen = (await a.c.rpc("resolve_radar_tokens", { p_event_id: ev.id, p_tokens: [tok] })).data;
    assert.equal(seen.people[0].user_id, b.id);
    assert.equal(seen.people[0].email, undefined);
    const blocked = await outsider.c.rpc("resolve_radar_tokens", { p_event_id: ev.id, p_tokens: [tok] });
    assert.match(blocked.error?.message || "", /not_a_member/);
  });

  test("tables are not directly readable or writable", async (t) => {
    if (!migrated) return t.skip("migration not applied");
    const toks = await a.c.from("radar_tokens").select("*");
    assert.equal(toks.data?.length || 0, 0);
    const att = await outsider.c.from("event_attendees").select("*").eq("event_id", ev.id);
    assert.equal(att.data?.length || 0, 0);
    const ins = await outsider.c.from("event_attendees").insert({ event_id: ev.id, user_id: outsider.id });
    assert.ok(ins.error, "direct membership insert must be refused");
  });
});
