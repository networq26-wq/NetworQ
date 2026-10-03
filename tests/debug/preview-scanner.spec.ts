import { test, expect } from "@playwright/test";

// Visual check of the Scan tab and the full-screen camera at phone size (fake camera feed).
test.use({ viewport: { width: 393, height: 852 }, permissions: ["camera"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

test("scanner: two options + iOS camera", async ({ page }) => {
  await page.goto("http://localhost:8081/?devLogin=a");
  await page.getByRole("button", { name: "Scan", exact: true }).first().click({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Scan with camera" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload a photo" })).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "qa-logs/scanner-tab.png" });
  await page.getByRole("button", { name: "Scan with camera" }).click();
  await expect(page.getByRole("button", { name: "Take photo" })).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "qa-logs/scanner-camera.png" });
  await page.getByRole("button", { name: "Close camera" }).click();
  await expect(page.getByRole("dialog", { name: "Card camera" })).toHaveCount(0);
});
