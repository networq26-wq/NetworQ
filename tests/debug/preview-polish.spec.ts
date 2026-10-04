import { test, expect } from "@playwright/test";
// Visual check of the premium polish pass at 360px on the ui-polish preview (8082).
test.use({ viewport: { width: 360, height: 780 }, permissions: ["camera"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });
test.setTimeout(240_000);
test("polish shots", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Slow Supabase reads a little so loading skeletons are visible
  await page.route(/supabase\.co\/rest\/v1\/(contacts|public_events)/, async (r) => { await new Promise((x) => setTimeout(x, 2500)); await r.continue(); });
  await page.goto("http://localhost:8082/?devLogin=a");
  await page.waitForTimeout(3500);
  await page.screenshot({ path: "qa-logs/polish-1-signing-in.png" }); // loading screen, not a frozen login form
  await expect(page.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "qa-logs/polish-2-home.png" });
  await page.getByRole("button", { name: "Events", exact: true }).last().click();
  await expect(page.getByRole("status", { name: "Loading events" })).toBeVisible();
  await page.screenshot({ path: "qa-logs/polish-3-events-skeleton.png" });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "qa-logs/polish-4-events.png" });
  await page.getByRole("button", { name: /^Notifications/ }).first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: "qa-logs/polish-5-notifications.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Scan", exact: true }).last().click();
  await page.getByRole("button", { name: "Scan with camera" }).click();
  await expect(page.getByRole("button", { name: "Take photo" })).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: "qa-logs/polish-6-camera.png" });
  await page.getByRole("button", { name: "Close camera" }).click();
  expect(errors).toEqual([]);
});
