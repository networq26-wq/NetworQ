import { test, expect } from "@playwright/test";
import { createHash } from "crypto";
import { AUTH_REDIRECT, buildAuthorizeUrl, exchangeCode, parseCallback, toBase64Url } from "../../shell/googleAuthCore";

test("PKCE challenge matches RFC 7636 test vector", () => {
  // Appendix B of RFC 7636
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest("base64"));
  expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("authorize URL asks Supabase for Google with S256 PKCE and the app redirect", () => {
  const u = new URL(buildAuthorizeUrl("https://x.supabase.co", "abc"));
  expect(u.pathname).toBe("/auth/v1/authorize");
  expect(u.searchParams.get("provider")).toBe("google");
  expect(u.searchParams.get("redirect_to")).toBe(AUTH_REDIRECT);
  expect(u.searchParams.get("code_challenge_method")).toBe("s256");
  expect(u.searchParams.get("code_challenge")).toBe("abc");
});

test("callback parsing: code, provider errors, cancellations, foreign URLs", () => {
  expect(parseCallback("networq://auth-callback?code=6f1c2b3a-1111-2222")).toEqual({ code: "6f1c2b3a-1111-2222" });
  expect(parseCallback("networq://auth-callback?error=access_denied&error_description=User+denied")).toEqual({ error: "User denied" });
  expect(parseCallback("networq://auth-callback#error=server_error")).toEqual({ error: "server_error" });
  expect(parseCallback("networq://auth-callback")).toEqual({ error: "Sign-in was cancelled." });
  expect(parseCallback("evil://auth-callback?code=6f1c2b3a-1111")).toEqual({ error: "Unexpected sign-in response." });
  expect(parseCallback("networq://auth-callback?code=<script>")).toEqual({ error: "Sign-in was cancelled." });
});

test("code exchange posts the verifier and returns tokens; errors surface", async () => {
  let seen: any;
  const ok = (async (url: string, init: any) => {
    seen = { url, init };
    return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt" }), { status: 200 });
  }) as any;
  await expect(exchangeCode("https://x.supabase.co", "anon", "code-1234", "ver", ok)).resolves.toEqual({ access_token: "at", refresh_token: "rt" });
  expect(seen.url).toBe("https://x.supabase.co/auth/v1/token?grant_type=pkce");
  expect(JSON.parse(seen.init.body)).toEqual({ auth_code: "code-1234", code_verifier: "ver" });
  expect(seen.init.headers.apikey).toBe("anon");
  const bad = (async () => new Response(JSON.stringify({ error_description: "invalid flow state" }), { status: 400 })) as any;
  await expect(exchangeCode("https://x.supabase.co", "anon", "c", "v", bad)).rejects.toThrow("invalid flow state");
});
