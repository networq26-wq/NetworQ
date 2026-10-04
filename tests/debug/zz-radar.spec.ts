import { test, expect } from "@playwright/test";
test("radar walkthrough", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("http://localhost:8082/?devLogin=a");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Radar" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "qa-logs/radar-1.png", fullPage: true });
  const snap = await page.locator("main, body").first().ariaSnapshot().catch(() => "");
  console.log(snap.split("\n").filter((l) => /button|switch|radio|heading|status|textbox|tab/.test(l)).slice(0, 60).join("\n"));
  const dump = async (tag: string) => {
    const t = await page.locator("body").ariaSnapshot();
    console.log(`=== ${tag}\n` + t.split("\n").filter((l) => /button|switch|radio|heading|status|textbox|tab|alert|paragraph/.test(l) && !/People|Messages"|Radar":|Events":|Global|Notifications|Profile/.test(l)).slice(0, 40).join("\n"));
  };
  const off = page.getByRole("button", { name: "Turn off Nearby" });
  if (await off.count()) { await off.click(); await page.getByRole("button", { name: "Confirm: Turn off Nearby" }).click(); await page.waitForTimeout(1500); }
  await page.screenshot({ path: "qa-logs/radar-1.png", fullPage: true });
  await page.getByRole("button", { name: "Turn on Nearby" }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "qa-logs/radar-2-nearby-on.png", fullPage: true });
  await dump("NEARBY ON");
  await page.getByRole("tab", { name: "Events" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "qa-logs/radar-3-events.png", fullPage: true });
  await dump("EVENTS TAB");
  console.log("errors:", JSON.stringify(errors));
});
