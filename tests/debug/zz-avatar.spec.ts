import { test, expect } from "@playwright/test";
const IMG = "/private/tmp/claude-501/-Volumes-Macintosh-HD---Data-NetworQ-main/8ca26726-2240-4ffb-9927-8bf08a5a0a39/scratchpad/face.png";
test("profile photo uploads (and replaces) on the live database", async ({ page }) => {
  test.setTimeout(200_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("http://localhost:8082/?devLogin=a");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Profile & Settings" }).first().click();
  await page.getByRole("button", { name: /^Profile Name/ }).click();
  for (const round of [1, 2]) {
    await page.getByLabel("Upload profile photo").setInputFiles(IMG);
    const ok = page.getByText("Photo updated.");
    const bad = page.getByText(/row-level security|violates/i);
    await expect(ok.or(bad).first()).toBeVisible({ timeout: 20_000 });
    console.log(`round ${round}:`, (await bad.count()) ? "FAILED " + (await bad.first().innerText()) : "Photo updated.");
    await page.waitForTimeout(3000);
  }
});
