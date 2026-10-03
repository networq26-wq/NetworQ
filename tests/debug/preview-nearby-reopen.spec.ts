import { test, expect } from "@playwright/test";
// Nearby already on when the app opens (reopen case): both must find each other without toggling.
test("Nearby works on reopen", async ({ page }) => {
  test.setTimeout(180_000);
  const logs: string[] = [];
  page.on("console", (m) => /shell|radar|error/i.test(m.text()) && logs.push(m.type() + ": " + m.text().slice(0, 160)));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto("http://localhost:8090");
  const A = page.frameLocator('iframe[title="iPhone 15 Pro"]');
  const B = page.frameLocator('iframe[title="Pixel 8 (Android)"]');
  for (const f of [A, B]) {
    await expect(f.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 60_000 });
    await f.getByRole("button", { name: "Radar", exact: true }).last().click();
    await f.getByRole("tab", { name: "Nearby" }).click();
    await expect(f.getByRole("switch", { name: "Discoverable" })).toHaveAttribute("aria-checked", "true", { timeout: 20_000 });
  }
  try {
    await expect(A.getByRole("list", { name: "Nearby attendees" }).getByText("Preview Bob")).toBeVisible({ timeout: 45_000 });
  } finally {
    console.log(logs.slice(-40).join("\n"));
    await page.screenshot({ path: "qa-logs/nearby-reopen.png" });
  }
});
