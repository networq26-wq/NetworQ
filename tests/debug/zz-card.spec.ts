import { test, expect } from "@playwright/test";
test("card with logo + photo", async ({ page }) => {
  test.setTimeout(200_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("http://localhost:8082/?devLogin=a");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Profile & Settings" }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "qa-logs/card-1.png", clip: { x: 0, y: 60, width: 393, height: 330 } });
});
