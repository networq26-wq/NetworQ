import { test, expect } from "@playwright/test";
test("home + ai sheet", async ({ page }) => {
  test.setTimeout(200_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("http://localhost:8082/?devLogin=a");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "qa-logs/home-1.png" });
  await page.getByRole("button", { name: "AI Assistant" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "qa-logs/home-2-ai-sheet.png" });
  await page.mouse.click(200, 60); // tap outside closes
  await page.waitForTimeout(500);
  await expect(page.getByRole("button", { name: "AI Assistant" })).toBeVisible();
  console.log("errors:", JSON.stringify(errors));
});
