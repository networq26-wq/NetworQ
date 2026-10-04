import { test, expect } from "@playwright/test";
test("scan page", async ({ page }) => {
  test.setTimeout(200_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("http://localhost:8082/?devLogin=a");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Scan a card" }).click();
  await page.waitForTimeout(800);
  const close = page.getByRole("button", { name: /close/i });
  if (await close.count()) await close.first().click().catch(() => {});
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "qa-logs/scan-1.png", fullPage: false });
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "qa-logs/scan-2.png" });
});
