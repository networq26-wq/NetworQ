import { test, expect } from "@playwright/test";
test.setTimeout(200_000);
test("mobile alignment shots", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("http://localhost:8082/?devLogin=a");
  await expect(page.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Radar", exact: true }).last().click();
  await page.getByRole("tab", { name: "Events" }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "qa-logs/m-radar-events.png" });
  await page.getByRole("button", { name: "Scan", exact: true }).last().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "qa-logs/m-scan.png" });
  await page.getByRole("button", { name: "Contacts", exact: true }).last().click();
  await page.waitForTimeout(900);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "qa-logs/m-contacts-toolbar.png" });
});
