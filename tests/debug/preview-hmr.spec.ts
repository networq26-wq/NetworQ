import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "fs";
test("device preview + Fast Refresh", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto("http://localhost:8090");
  const frames = page.frameLocator('iframe[title="iPhone 15 Pro"]');
  await expect(frames.getByText("Meet. Remember. Reconnect.")).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "qa-logs/preview-setup.png" });
  const marker = "window.__hmrProbe = 1";
  await page.frames()[1].evaluate(() => ((window as any).__noReload = true));
  const src = readFileSync("App.tsx", "utf8");
  writeFileSync("App.tsx", src.replace("Meet. Remember. Reconnect.", "Meet. Remember. Reconnect. ✓ live"));
  try {
    const t0 = Date.now();
    for (const name of ["iPhone 15 Pro", "Pixel 8 (Android)", "Small Android (360 × 740)"]) {
      await expect(page.frameLocator(`iframe[title="${name}"]`).getByText("Meet. Remember. Reconnect. ✓ live")).toBeVisible({ timeout: 60_000 });
    }
    console.log(`Fast Refresh updated all 3 devices in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const stillSame = await page.frames()[1].evaluate(() => (window as any).__noReload === true);
    console.log(`state kept (no full reload): ${stillSame}`);
  } finally {
    writeFileSync("App.tsx", src);
  }
});
