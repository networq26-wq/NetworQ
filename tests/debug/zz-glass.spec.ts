import { test, expect } from "@playwright/test";
test("liquid glass dock", async ({ page }) => {
  test.setTimeout(200_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("http://localhost:8082/?devLogin=a");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Events", exact: true }).last().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "qa-logs/glass-events.png" });
  await page.getByRole("button", { name: "Pass", exact: true }).last().click();
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 250);
  await page.waitForTimeout(800);
  await page.screenshot({ path: "qa-logs/glass-pass.png" });
  console.log("errors:", JSON.stringify(errors));
});
