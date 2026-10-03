import { test, expect } from "@playwright/test";
test("one preview page, two signed-in users, Radar between them", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto("http://localhost:8090");
  const A = page.frameLocator('iframe[title="iPhone 15 Pro"]');
  const B = page.frameLocator('iframe[title="Pixel 8 (Android)"]');
  await expect(A.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 60_000 });
  await expect(B.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 60_000 });
  console.log("A signed in as:", await A.getByRole("button", { name: "Profile & Settings" }).getByTitle(/Preview/).first().getAttribute("title").catch(() => "?"));
  console.log("B signed in as:", await B.getByRole("button", { name: "Profile & Settings" }).getByTitle(/Preview/).first().getAttribute("title").catch(() => "?"));
  for (const f of [A, B]) await f.getByRole("button", { name: "Radar", exact: true }).last().click();
  // A: fresh event
  await expect(A.getByRole("button", { name: "Leave event", exact: true }).or(A.getByRole("button", { name: "Create event" }))).toBeVisible({ timeout: 20_000 });
  for (const f of [A, B]) {
    for (let i = 0; i < 6 && (await f.getByRole("button", { name: "Leave event", exact: true }).count()); i++) {
      await f.getByRole("button", { name: "Leave event", exact: true }).click();
      await f.getByRole("button", { name: "Confirm leave event", exact: true }).click();
      await page.waitForTimeout(1500);
    }
  }
  await A.getByRole("button", { name: "Create event" }).click();
  await A.getByLabel("Event name").fill("Two-user preview");
  await A.getByRole("button", { name: "Create & get code" }).click();
  const code = (await A.getByRole("dialog", { name: "Share event" }).getByText(/^NQ-[A-Z0-9]{6}$/).textContent())!.trim();
  await A.getByRole("dialog", { name: "Share event" }).getByRole("button", { name: "Close" }).click();
  await B.getByLabel("Event code", { exact: true }).fill(code);
  await B.getByRole("button", { name: "Join event" }).click();
  await expect(A.getByRole("list", { name: "Nearby attendees" }).getByText("Preview Bob")).toBeVisible({ timeout: 40_000 });
  await expect(B.getByRole("list", { name: "Nearby attendees" }).getByText("Preview Asha")).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "qa-logs/preview-two-users.png" });
  console.log("✔ A and B see each other in one preview page");
});
