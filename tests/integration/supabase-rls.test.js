// Live tenant-isolation tests against a real Supabase project.
// Opt-in only:  QA_LIVE_SUPABASE=1 npm run test:rls
// Creates two throwaway confirmed users via the admin API and deletes them afterwards.
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
const enabled = process.env.QA_LIVE_SUPABASE === "1" && URL_ && ANON && SERVICE;

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const password = `QaRls!${Date.now()}x`;
const created = [];
let admin, A, B, clientA, clientB, anon, contactId;

async function makeUser(tag) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `qa-rls-${tag}-${Date.now()}@example.com`,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  created.push(data.user.id);
  return data.user;
}

async function signIn(user) {
  const c = createClient(URL_, ANON, opts);
  const { error } = await c.auth.signInWithPassword({ email: user.email, password });
  if (error) throw error;
  return c;
}

test.describe("Supabase row-level security", { skip: !enabled && "set QA_LIVE_SUPABASE=1 to run" }, () => {
  test.before(async () => {
    admin = createClient(URL_, SERVICE, opts);
    A = await makeUser("a");
    B = await makeUser("b");
    clientA = await signIn(A);
    clientB = await signIn(B);
    anon = createClient(URL_, ANON, opts);
    const { data, error } = await clientA.from("contacts").insert({ user_id: A.id, name: "QA RLS Contact" }).select().single();
    if (error) throw error;
    contactId = data.id;
  });

  test.after(async () => {
    if (contactId) await admin.from("contacts").delete().eq("id", contactId);
    for (const id of created) await admin.auth.admin.deleteUser(id);
  });

  test("owner can read own contact", async () => {
    const { data } = await clientA.from("contacts").select("id").eq("id", contactId);
    assert.equal(data.length, 1);
  });

  test("other user cannot read the contact", async () => {
    const { data } = await clientB.from("contacts").select("id").eq("id", contactId);
    assert.equal(data.length, 0);
  });

  test("other user cannot update the contact", async () => {
    const { data } = await clientB.from("contacts").update({ name: "hacked" }).eq("id", contactId).select();
    assert.equal(data?.length || 0, 0);
  });

  test("other user cannot delete the contact", async () => {
    const { data } = await clientB.from("contacts").delete().eq("id", contactId).select();
    assert.equal(data?.length || 0, 0);
    const { data: still } = await admin.from("contacts").select("id").eq("id", contactId);
    assert.equal(still.length, 1);
  });

  test("user cannot insert a contact owned by someone else", async () => {
    const { error } = await clientA.from("contacts").insert({ user_id: B.id, name: "spoof" });
    assert.ok(error, "insert as another user must fail");
  });

  for (const table of ["contacts", "profiles", "follow_up_emails", "meetings", "ai_usage", "business_card_scans", "waitlist"]) {
    test(`anonymous visitors cannot read ${table}`, async () => {
      const { data } = await anon.from(table).select("*").limit(1);
      assert.equal(data?.length || 0, 0);
    });
  }

  test("increment_ai_usage cannot target another user", async () => {
    const { data, error } = await clientA.rpc("increment_ai_usage", { p_user_id: B.id, p_action: "card_scan" });
    const { data: rows } = await admin.from("ai_usage").select("count").eq("user_id", B.id);
    assert.ok(error || (rows || []).length === 0, `quota of user B was modified: ${JSON.stringify(data)}`);
  });

  test("users cannot reset their own AI quota", async () => {
    await clientA.rpc("increment_ai_usage", { p_user_id: A.id, p_action: "card_scan" });
    await clientA.from("ai_usage").update({ count: 0 }).eq("user_id", A.id);
    const { data } = await admin.from("ai_usage").select("count").eq("user_id", A.id).eq("action", "card_scan");
    assert.ok((data?.[0]?.count || 0) >= 1, "user was able to reset their own usage counter");
  });
});
