import { test, expect } from "@playwright/test";
test("realtime: request → accept → contact appears without reload", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto("http://localhost:8090");
  const A = page.frameLocator('iframe[title="iPhone 15 Pro"]');
  const B = page.frameLocator('iframe[title="Pixel 8 (Android)"]');
  for (const f of [A, B]) await expect(f.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 60_000 });
  for (const f of [A, B]) await f.getByRole("button", { name: "Radar", exact: true }).last().click();
  for (const f of [A, B]) {
    await expect(f.getByRole("button", { name: "Leave event", exact: true }).or(f.getByRole("button", { name: "Create event" }))).toBeVisible({ timeout: 20_000 });
    for (let i = 0; i < 6 && (await f.getByRole("button", { name: "Leave event", exact: true }).count()); i++) {
      await f.getByRole("button", { name: "Leave event", exact: true }).click();
      await f.getByRole("button", { name: "Confirm leave event", exact: true }).click();
      await page.waitForTimeout(1500);
    }
  }
  await A.getByRole("button", { name: "Create event" }).click();
  await A.getByLabel("Event name").fill("Realtime check");
  await A.getByRole("button", { name: "Create & get code" }).click();
  const code = (await A.getByRole("dialog", { name: "Share event" }).getByText(/^NQ-[A-Z0-9]{6}$/).textContent())!.trim();
  await A.getByRole("dialog", { name: "Share event" }).getByRole("button", { name: "Close" }).click();
  await B.getByLabel("Event code", { exact: true }).fill(code);
  await B.getByRole("button", { name: "Join event" }).click();
  const nearbyA = A.getByRole("list", { name: "Nearby attendees" });
  await expect(nearbyA.getByText("Preview Bob")).toBeVisible({ timeout: 40_000 });

  let t0 = Date.now();
  await nearbyA.getByRole("button", { name: "Connect" }).click();
  const req = B.getByRole("region", { name: "Connection requests" });
  await expect(req.getByText("Preview Asha")).toBeVisible({ timeout: 30_000 });
  console.log(`B received the request after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await expect(B.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible({ timeout: 15_000 });
  console.log("B bell badge:", await B.getByRole("button", { name: /Notifications, \d+ unread/ }).getAttribute("aria-label"));

  await A.getByRole("button", { name: "Contacts", exact: true }).last().click(); // A waits on Contacts — no reload
  t0 = Date.now();
  await req.getByRole("button", { name: "Accept" }).click();
  await expect(A.getByText("Preview Bob accepted your request").first()).toBeVisible({ timeout: 30_000 });
  console.log(`A notified of acceptance after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await expect(A.getByText("Preview Bob", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  console.log(`A's contact list shows Preview Bob after ${((Date.now() - t0) / 1000).toFixed(1)}s (no reload)`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "qa-logs/preview-realtime.png" });
});
