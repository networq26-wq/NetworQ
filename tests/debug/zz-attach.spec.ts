import { test, expect, type Page } from "@playwright/test";
const S = "/private/tmp/claude-501/-Volumes-Macintosh-HD---Data-NetworQ-main/8ca26726-2240-4ffb-9927-8bf08a5a0a39/scratchpad";
test.setTimeout(300_000);
async function boot(page: Page, host: string, who: string) {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`http://${host}:8082/?devLogin=${who}`);
  await expect(page.getByRole("complementary")).toBeVisible({ timeout: 120_000 });
}
test("photo + file in chat: sender uploads, receiver sees the preview and the file card", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
  await boot(a, "localhost", "a");
  await boot(b, "127.0.0.1", "b");
  await a.getByRole("button", { name: "Relationship", exact: true }).click();
  await a.getByRole("button", { name: "Message", exact: true }).click();
  await expect(a.getByRole("button", { name: "Attach a photo or file" })).toBeEnabled({ timeout: 20_000 });
  await a.getByPlaceholder(/^Message /).fill("Card from today");
  await a.locator('input[type="file"][aria-label="Attach a photo or file"]').setInputFiles(`${S}/bigphoto.jpg`);
  await expect(a.getByRole("button", { name: "Open photo" }).last()).toBeVisible({ timeout: 30_000 });
  await a.locator('input[type="file"][aria-label="Attach a photo or file"]').setInputFiles(`${S}/deck.pdf`);
  await expect(a.getByRole("button", { name: "Open deck.pdf" }).last()).toBeVisible({ timeout: 30_000 });
  await a.waitForTimeout(1500);
  await a.screenshot({ path: "qa-logs/attach-a.png" });
  // Bob opens the conversation
  await b.getByRole("button", { name: /Notifications, \d+ unread/ }).click({ timeout: 30_000 });
  await b.getByRole("dialog", { name: "Notifications" }).getByText("Preview Asha").first().click();
  const photo = b.getByRole("button", { name: "Open photo" }).last();
  await expect(photo).toBeVisible({ timeout: 30_000 });
  await expect(b.getByRole("button", { name: "Open deck.pdf" }).last()).toBeVisible();
  const loaded = await b.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('button[aria-label="Open photo"] img')] as HTMLImageElement[];
    const img = imgs[imgs.length - 1];
    return img && img.complete && img.naturalWidth > 0 ? img.naturalWidth : false;
  }, null, { timeout: 30_000 });
  console.log("receiver photo width:", await loaded.jsonValue());
  await b.screenshot({ path: "qa-logs/attach-b.png" });
  console.log("errors:", JSON.stringify(errors));
});
