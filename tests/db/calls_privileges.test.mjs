// Supabase grants EXECUTE on every new public function to anon/authenticated/service_role via
// ALTER DEFAULT PRIVILEGES. "revoke ... from public, anon" therefore leaves `authenticated` able to
// call internal helpers. This reproduces that environment and checks which call helpers a signed-in
// user can execute directly (PostgREST: POST /rest/v1/rpc/<fn>).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDb } from "./harness.mjs";

const M = ["20261001_security_hardening.sql", "20261002_event_radar.sql", "20261005_connections_dedupe.sql", "20261003_account_email_events.sql", "20261006_realtime_notifications.sql",
           "20261008_nearby_radar.sql", "20261010_push_notifications.sql", "20261011_realtime_chat.sql", "20261012_chat_hardening.sql", "20261013_calls.sql", "20261014_release_hardening.sql"];

test("internal call helpers are not executable by signed-in users (Supabase default privileges)", async () => {
  const h = await createDb();
  await h.db.exec("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role");
  for (const m of M) await h.db.exec(readFileSync(new URL(`../../supabase/migrations/${m}`, import.meta.url), "utf8"));
  const can = async (sig) => (await h.db.query("select has_function_privilege('authenticated', $1, 'execute') as ok", [sig])).rows[0].ok;
  assert.equal(await can("start_call(uuid,text)"), true);
  assert.equal(await can("call_mark_missed(calls)"), false, "call_mark_missed is a security-definer notification writer");
  assert.equal(await can("call_ring_expired(calls)"), false);
});
