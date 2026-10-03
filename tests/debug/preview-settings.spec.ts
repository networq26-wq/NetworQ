import { test, expect } from "@playwright/test";
test.use({ viewport: { width: 393, height: 852 } });
test("settings extras", async ({ page }) => {
  await page.goto("http://localhost:8081/?devLogin=a");
  await page.getByTitle("Profile & Settings").click({ timeout: 60_000 });
  await page.getByRole("heading", { name: "Blocked people" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "qa-logs/settings-blocked.png" });
  await page.getByRole("heading", { name: "Help & support" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "qa-logs/settings-help.png" });
  await page.getByRole("list", { name: "Recent devices" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: "qa-logs/settings-devices.png" });
});
