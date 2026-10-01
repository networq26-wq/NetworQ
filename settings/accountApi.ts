// Client for the server's account endpoints (api/account.js).
import type { SupabaseClient } from "@supabase/supabase-js";

export function apiBase(aiProxyUrl: string): string {
  return aiProxyUrl.replace(/\/api\/ai$/, "");
}

async function authedPost(supabase: SupabaseClient, url: string, body?: unknown) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Please sign in again.");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export function createAccountApi(supabase: SupabaseClient, base: string) {
  return {
    sessionEvent: (type: "signed_in" | "password_changed") => authedPost(supabase, `${base}/api/auth/session-event`, { type }),
    scheduleDeletion: () => authedPost(supabase, `${base}/api/account/delete`, { confirm: "DELETE" }) as Promise<{ scheduled_for: string }>,
    cancelDeletion: () => authedPost(supabase, `${base}/api/account/cancel-deletion`),
  };
}

export type AccountApi = ReturnType<typeof createAccountApi>;
