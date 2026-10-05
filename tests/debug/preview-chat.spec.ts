import { test, expect, type Page } from "@playwright/test";
// Live two-user chat on the ui-polish preview (8082): Asha (localhost) → Bob (127.0.0.1), real Supabase.
test.setTimeout(240_000);
async function boot(page: Page, host: string, who: string) {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`http://${host}:8082/?devLogin=${who}`);
  await expect(page.getByRole("complementary")).toBeVisible({ timeout: 90_000 });
}
test("live chat between connected users", async ({ browser }) => {
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  const errors: string[] = [];
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
  await boot(a, "localhost", "a");
  await boot(b, "127.0.0.1", "b");
  // Bob is the selected contact in the desktop inspector by default
  await a.getByRole("button", { name: "Relationship", exact: true }).click();
  await a.getByRole("button", { name: "Message" }).click();
  const box = a.getByPlaceholder(/^Message /);
  await expect(box).toBeVisible({ timeout: 20_000 });
  const text = `Hi Bob — live chat check ${Date.now() % 100000}`;
  await box.fill(text);
  await box.press("Enter");
  await expect(a.getByText(text)).toBeVisible({ timeout: 15_000 });
  const t0 = Date.now();
  await expect(b.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible({ timeout: 30_000 });
  console.log("bell lit after", Date.now() - t0, "ms");
  await b.getByRole("button", { name: /Notifications, \d+ unread/ }).click();
  await b.getByRole("dialog", { name: "Notifications" }).getByText("Preview Asha").first().click();
  await expect(b.getByText(text)).toBeVisible({ timeout: 20_000 });
  await b.screenshot({ path: "qa-logs/chat-bob.png" });
  await a.screenshot({ path: "qa-logs/chat-asha.png" });
  console.log("page errors:", JSON.stringify(errors));
});
