import { test, expect } from "@playwright/test";
test.use({ viewport: { width: 393, height: 852 } });
test("digital pass", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:8081/?devLogin=a");
  await page.getByRole("button", { name: "Pass", exact: true }).last().click({ timeout: 60_000 });
  await expect(page.getByRole("img", { name: "QR Code" })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "qa-logs/pass-1.png" });
  await page.getByRole("radio", { name: "Midnight" }).click();
  await page.getByLabel("Customise pass").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "qa-logs/pass-2-midnight.png" });
  expect(errors).toEqual([]);
});
