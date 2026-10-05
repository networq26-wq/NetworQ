import { test, expect } from "@playwright/test";
test("sign-in screen stays below the status bar, even when content is taller than the screen", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 393, height: 520 }); // like a phone with the keyboard open
  // exactly what the Android shell injects
  await page.addInitScript(() => {
    const add = () => {
      const st = document.createElement("style");
      st.textContent = ":root { --safe-top: 36px !important; --safe-bottom: 24px !important; }";
      document.head.appendChild(st);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  });
  await page.goto("http://localhost:8082/");
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const top = await page.evaluate(() => {
    const logo = document.querySelector('[aria-label="NetworQ"], img[alt="NetworQ"]') as HTMLElement | null;
    return logo ? logo.getBoundingClientRect().top : null;
  });
  console.log("logo top:", top);
  await page.screenshot({ path: "qa-logs/login-short.png" });
  expect(top).not.toBeNull();
  expect(top!).toBeGreaterThanOrEqual(36);
});
