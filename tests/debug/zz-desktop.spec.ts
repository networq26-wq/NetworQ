import { test, expect } from "@playwright/test";
test.setTimeout(300_000);
test("desktop screens", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("http://localhost:8082/?devLogin=a");
  await expect(page.getByRole("complementary")).toBeVisible({ timeout: 90_000 });
  const side = page.getByRole("complementary");
  const names = await side.getByRole("button").allInnerTexts();
  console.log("SIDEBAR:", names.map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean).join(" | "));
  await page.waitForTimeout(800);
  await page.screenshot({ path: "qa-logs/desk-1-home.png" });
  for (const [i, re] of [[2, /^Events Hub/], [3, /^Proximity Radar/], [4, /^Card Scanner/], [5, /^Digital Pass/]] as const) {
    await side.getByRole("button", { name: re }).first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `qa-logs/desk-${i}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await side.getByRole("button", { name: /^All Contacts/ }).first().click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "qa-logs/desk-6-1440.png" });
});
