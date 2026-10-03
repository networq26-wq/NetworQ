import { test, expect } from "@playwright/test";
for (const mode of ["web", "android"]) {
  test(`google in preview (${mode})`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.addInitScript((m) => localStorage.setItem("nq-preview", JSON.stringify({ path: "/", mode: m, zoom: "0.85", ble: "-79" })), mode);
    await page.goto("http://localhost:8090");
    const f = page.frameLocator('iframe[title="iPhone 15 Pro"]');
    await expect(f.getByRole("button", { name: "Continue with Google" })).toBeVisible({ timeout: 60000 });
    const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 15000 }), f.getByRole("button", { name: "Continue with Google" }).click()]);
    await popup.waitForLoadState("domcontentloaded");
    console.log(`[${mode}] new tab: ${popup.url().slice(0, 60)}… title="${await popup.title()}"`);
    console.log(`[${mode}] preview frame says: ${(await f.locator("body").innerText()).match(/Finish signing in[^.]*\./)?.[0]}`);
  });
}
