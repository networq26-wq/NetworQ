import { test, expect, type Page } from "@playwright/test";
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] } });
test.setTimeout(360_000);
async function boot(page: Page, host: string, who: string, mobile = false) {
  await page.setViewportSize(mobile ? { width: 393, height: 852 } : { width: 1280, height: 860 });
  await page.goto(`http://${host}:8082/?devLogin=${who}`);
  await expect(page.getByRole("button", { name: "Profile & Settings" }).first()).toBeVisible({ timeout: 120_000 });
}
const remoteVideos = (p: Page) => p.evaluate(() => Array.from(document.querySelectorAll('[aria-label="Group call"] video')).filter((v: any) => !v.muted && v.videoWidth > 0).length);

test("group video call: host rings two people, all three see each other, then everyone leaves", async ({ browser }) => {
  const mk = async () => (await browser.newContext({ permissions: ["camera", "microphone"] })).newPage();
  const a = await mk(), b = await mk(), c = await mk();
  const errors: string[] = [];
  for (const [p, n] of [[a, "A"], [b, "B"], [c, "C"]] as const) p.on("pageerror", (e) => errors.push(`${n}: ${e.message}`));
  await boot(a, "localhost", "a", true);
  await boot(b, "127.0.0.1", "b");
  await boot(c, "[::1]", "c").catch(async () => boot(c, "0.0.0.0", "c"));

  // Asha: People → Select → pick Bob + Cara → Call 2
  await a.getByRole("button", { name: "Select", exact: true }).click();
  for (const n of ["Preview Bob", "Preview Cara"]) await a.getByRole("button", { name: `Select ${n}` }).first().click();
  await a.getByRole("button", { name: /^Group call 2 people/ }).click();
  const gA = a.getByRole("dialog", { name: "Group call" });
  await expect(gA.getByRole("status")).toHaveText(/Ringing 2 people/, { timeout: 30_000 });

  for (const p of [b, c]) {
    const g = p.getByRole("dialog", { name: "Group call" });
    await expect(g.getByRole("status")).toHaveText(/Group video call · 3 people/, { timeout: 30_000 });
    await g.getByRole("button", { name: "Join" }).click();
  }
  const t0 = Date.now();
  await expect.poll(async () => [await remoteVideos(a), await remoteVideos(b), await remoteVideos(c)].join(","), { timeout: 60_000 }).toBe("2,2,2");
  console.log("everyone sees everyone after", Date.now() - t0, "ms");
  await a.screenshot({ path: "qa-logs/groupcall-a.png" });
  await b.screenshot({ path: "qa-logs/groupcall-b.png" });

  // Cara leaves → the other two keep talking, each now sees 1
  await c.getByRole("dialog", { name: "Group call" }).getByRole("button", { name: "Leave" }).click();
  await expect.poll(async () => [await remoteVideos(a), await remoteVideos(b)].join(","), { timeout: 30_000 }).toBe("1,1");
  await gA.getByRole("button", { name: "Leave" }).click();
  await b.getByRole("dialog", { name: "Group call" }).getByRole("button", { name: "Leave" }).click();
  await expect(gA).toHaveCount(0, { timeout: 10_000 });
  console.log("errors:", JSON.stringify(errors));
});
