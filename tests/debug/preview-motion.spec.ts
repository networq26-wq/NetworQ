import { test, expect } from "@playwright/test";
// Records the motion polish on the ui-polish preview (port 8082) at phone size.
test.use({ viewport: { width: 393, height: 852 }, video: { mode: "on", size: { width: 393, height: 852 } } });
test.setTimeout(180_000);
test("motion walkthrough", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:8082/?devLogin=a");
  await expect(page.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "qa-logs/motion-1-home.png" });
  for (const tab of ["Events", "Radar", "Scan", "Pass", "Contacts"]) {
    await page.getByRole("button", { name: tab, exact: true }).last().click();
    await page.waitForTimeout(140);
    if (tab === "Events") await page.screenshot({ path: "qa-logs/motion-2-mid-transition.png" });
    await page.waitForTimeout(900);
  }
  await page.getByRole("button", { name: /^Notifications/ }).first().click();
  await page.waitForTimeout(120);
  await page.screenshot({ path: "qa-logs/motion-3-sheet-mid.png" });
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  // Long toast on a narrow screen must wrap, centred, never off-screen
  await page.getByRole("button", { name: "Pass", exact: true }).last().click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Share", exact: true }).click(); // no Web Share in this browser → long toast
  await page.waitForTimeout(700);
  await page.screenshot({ path: "qa-logs/motion-4-toast.png" });
  const box = await page.locator("text=Sharing isn't available here").boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 393).toBeTruthy();
  expect(errors).toEqual([]);
});
