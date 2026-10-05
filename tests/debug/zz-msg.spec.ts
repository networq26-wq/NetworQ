import { test, expect } from "@playwright/test";
test("new message picker", async ({ page }) => {
  test.setTimeout(200_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("http://localhost:8082/?devLogin=a");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Messages" }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "qa-logs/msg-1.png" });
  await page.getByRole("button", { name: "New message" }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "qa-logs/msg-2-picker.png" });
  await page.getByRole("button", { name: /^Message Preview Bob/ }).click();
  await expect(page.getByPlaceholder(/^Message /)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(4000);
  const bubbles = await page.getByText("Great meeting you!").count();
  console.log("history bubbles:", bubbles);
  await page.screenshot({ path: "qa-logs/msg-3-chat.png" });
});
