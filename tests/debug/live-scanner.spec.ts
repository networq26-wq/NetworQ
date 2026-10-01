// One-off reproduction against the LIVE production bundle (Supabase mocked, no prod data touched)
import { test, expect } from "@playwright/test";
import { MockSupabase } from "../e2e/mock-supabase";

test.use({ baseURL: "https://www.networq.co.in" });

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 412, height: 915 }]) {
  test(`live: open scanner tab (${vp.name})`, async ({ browser }) => {
    const db = new MockSupabase();
    db.addUser("qa@acme.test", "CorrectHorse9!", { profile: { name: "QA", company: "Acme", role: "Founder" } });
    const ctx = await browser.newContext({ viewport: vp, isMobile: vp.name === "phone", hasTouch: vp.name === "phone" });
    // allow the live origin, mock Supabase, block everything else
    await ctx.route("**/*", (r) => (new URL(r.request().url()).hostname.endsWith("networq.co.in") ? r.continue() : r.abort()));
    await ctx.route(/\/auth\/v1\//, (r) => (db as any).handleAuth(r));
    await ctx.route(/\/rest\/v1\//, (r) => (db as any).handleRest(r));
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 300)));
    page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text().slice(0, 300)));
    await page.goto("/");
    await page.getByPlaceholder("name@company.com").fill("qa@acme.test");
    await page.locator('input[type="password"]').fill("CorrectHorse9!");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 15000 });
    const btn = vp.name === "phone" ? page.getByRole("button", { name: "Scan", exact: true }).last() : page.getByRole("button", { name: /^Card Scanner/ }).first();
    await btn.click();
    await page.waitForTimeout(2500);
    const bodyText = (await page.locator("body").innerText()).slice(0, 200).replace(/\n/g, " | ");
    console.log(`[${vp.name}] errors:`, JSON.stringify(errors, null, 1));
    console.log(`[${vp.name}] body after opening scanner:`, JSON.stringify(bodyText));
    await page.screenshot({ path: `test-results/live-scanner-${vp.name}.png` });
    await ctx.close();
  });
}
