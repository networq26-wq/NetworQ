import { test, expect } from "@playwright/test";
test.use({ viewport: { width: 393, height: 852 } });
test("events hub with live data", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:8081/?devLogin=a");
  await page.getByRole("button", { name: "Events", exact: true }).last().click({ timeout: 60_000 });
  await expect(page.getByRole("list", { name: "Upcoming events" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("region", { name: "Filters" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "qa-logs/events-1.png" });
  await page.getByRole("group", { name: "Filter by date" }).getByRole("button", { name: "This week", exact: true }).click();
  await page.getByRole("group", { name: "Filter by category" }).getByRole("button", { name: /^AI & Data/ }).click();
  await page.getByLabel("City").selectOption("All India");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "qa-logs/events-2-filtered.png" });
  console.log(await page.getByRole("region", { name: "Filters" }).innerText());
  expect(errors).toEqual([]);
});
