import { test, expect } from "@playwright/test";
test("sign-in in another tab updates the preview frames", async ({ context }) => {
  const preview = await context.newPage();
  await preview.setViewportSize({ width: 1500, height: 1000 });
  await preview.goto("http://localhost:8090");
  const f = preview.frameLocator('iframe[title="iPhone 15 Pro"]');
  await expect(f.getByRole("button", { name: "Sign In", exact: true })).toBeVisible({ timeout: 60000 });
  const tab = await context.newPage();
  await tab.goto("http://localhost:8081/");
  await tab.getByPlaceholder("name@company.com").fill("preview.a@networq.co.in");
  await tab.getByLabel("Password", { exact: true }).fill("Preview#2026");
  await tab.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(tab.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 30000 });
  const t0 = Date.now();
  await expect(f.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 30000 });
  console.log(`preview frame signed in automatically after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
});
