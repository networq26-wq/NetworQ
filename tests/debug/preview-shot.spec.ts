import { test, expect } from "@playwright/test";
test("preview screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1050 });
  await page.goto("http://localhost:8090");
  await expect(page.frameLocator('iframe[title="iPhone 15 Pro"]').getByText("Meet. Remember. Reconnect.")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "qa-logs/preview-setup.png" });
});
