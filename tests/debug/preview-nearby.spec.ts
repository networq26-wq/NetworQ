import { test, expect } from "@playwright/test";
// Nearby (no event) between the two preview users, with the simulated BLE shell.
test("Nearby radar between two preview users", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto("http://localhost:8090");
  const A = page.frameLocator('iframe[title="iPhone 15 Pro"]');
  const B = page.frameLocator('iframe[title="Pixel 8 (Android)"]');
  for (const f of [A, B]) {
    await expect(f.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 60_000 });
    await f.getByRole("button", { name: "Radar", exact: true }).last().click();
    await f.getByRole("tab", { name: "Nearby" }).click();
    // start from a clean state
    if (await f.getByRole("button", { name: "Turn off Nearby" }).count()) {
      await f.getByRole("button", { name: "Turn off Nearby" }).click();
      await f.getByRole("button", { name: "Confirm: Turn off Nearby" }).click();
    }
    await expect(f.getByRole("button", { name: "Turn on Nearby" })).toBeVisible({ timeout: 20_000 });
  }
  await page.screenshot({ path: "qa-logs/nearby-1-intro.png" });
  for (const f of [A, B]) await f.getByRole("button", { name: "Turn on Nearby" }).click();
  await expect(A.getByRole("list", { name: "Nearby attendees" }).getByText("Preview Bob")).toBeVisible({ timeout: 40_000 });
  await expect(B.getByRole("list", { name: "Nearby attendees" }).getByText("Preview Asha")).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "qa-logs/nearby-2-found.png" });

  // B goes undiscoverable → A loses B (tokens revoked), B sees only a count
  await B.getByRole("switch", { name: "Discoverable" }).click();
  await expect(A.getByRole("list", { name: "Nearby attendees" })).toHaveCount(0, { timeout: 60_000 });
  await page.screenshot({ path: "qa-logs/nearby-3-hidden.png" });
  await B.getByRole("switch", { name: "Discoverable" }).click();
  await expect(A.getByRole("list", { name: "Nearby attendees" }).getByText("Preview Bob")).toBeVisible({ timeout: 60_000 });
  console.log("console errors:", errors);
});
