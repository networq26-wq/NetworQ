// Pure helpers for Google sign-in from the Android shell (PKCE via the system browser).
// Google blocks OAuth inside embedded WebViews, so the shell opens a Custom Tab,
// receives networq://auth-callback?code=…, and exchanges the code for a session.

export const AUTH_REDIRECT = "networq://auth-callback";

export function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildAuthorizeUrl(supabaseUrl: string, codeChallenge: string): string {
  const q = new URLSearchParams({
    provider: "google",
    redirect_to: AUTH_REDIRECT,
    code_challenge: codeChallenge,
    code_challenge_method: "s256",
  });
  return `${supabaseUrl}/auth/v1/authorize?${q.toString()}`;
}

export type CallbackResult = { code: string } | { error: string };

export function parseCallback(url: string): CallbackResult {
  if (!url.startsWith(AUTH_REDIRECT)) return { error: "Unexpected sign-in response." };
  const query = url.split("?")[1]?.split("#")[0] || "";
  const hash = url.split("#")[1] || "";
  const params = new URLSearchParams(query);
  const hashParams = new URLSearchParams(hash);
  const error = params.get("error_description") || params.get("error") || hashParams.get("error_description") || hashParams.get("error");
  if (error) return { error: error.replace(/\+/g, " ") };
  const code = params.get("code");
  return code && /^[A-Za-z0-9-]{8,}$/.test(code) ? { code } : { error: "Sign-in was cancelled." };
}

export async function exchangeCode(
  supabaseUrl: string,
  anonKey: string,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ access_token: string; refresh_token: string }> {
  const res = await fetchImpl(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new Error(json.error_description || json.msg || "Couldn't complete Google sign-in.");
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token };
}
