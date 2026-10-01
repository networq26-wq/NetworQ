import { test, expect, PASSWORD, PROFILE } from "./fixtures";

test.describe("Google sign-in inside the Android app", () => {
  test("old app shells without native Google support hide the button", async ({ page }) => {
    await page.addInitScript(() => ((window as any).ReactNativeWebView = { postMessage() {} }));
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  });

  test("new shells sign in through the system browser and hand the session back", async ({ page, db }) => {
    db.addUser("gina@gmail.test", PASSWORD, { profile: PROFILE });
    await page.addInitScript(() => {
      (window as any).__NETWORQ_SHELL__ = { googleAuth: true };
      (window as any).__sent = [];
      (window as any).ReactNativeWebView = { postMessage: (m: string) => (window as any).__sent.push(JSON.parse(m)) };
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__sent.map((m: any) => m.type))).toContain("auth:google");

    // Native side finishes PKCE and injects the session
    const session = await page.evaluate(async () => {
      const r = await fetch("https://jpuxmkkuzqojqeatespa.supabase.co/auth/v1/token?grant_type=password", { method: "POST", headers: { "Content-Type": "application/json", apikey: "x" }, body: JSON.stringify({ email: "gina@gmail.test", password: "CorrectHorse9!" }) });
      return r.json();
    });
    await page.evaluate((s) => window.dispatchEvent(new CustomEvent("networq-native", { detail: { type: "auth:session", access_token: s.access_token, refresh_token: s.refresh_token } })), session);
    await expect(page.getByRole("button", { name: "Profile & Settings" })).toBeVisible();
  });

  test("native errors are shown on the sign-in screen", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__NETWORQ_SHELL__ = { googleAuth: true };
      (window as any).ReactNativeWebView = { postMessage() {} };
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("networq-native", { detail: { type: "auth:error", message: "Google sign-in was cancelled." } })));
    await expect(page.getByText("Google sign-in was cancelled.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });
});
