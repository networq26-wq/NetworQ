import { test, expect, type Page } from "@playwright/test";
// Live two-user VIDEO CALL on the preview (8082), real Supabase: Asha (localhost) calls Bob (127.0.0.1).
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] } });
test.setTimeout(300_000);
async function boot(page: Page, host: string, who: string) {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`http://${host}:8082/?devLogin=${who}`);
  await expect(page.getByRole("complementary")).toBeVisible({ timeout: 120_000 });
}
const videoSize = (p: Page, sel: string) => p.evaluate((s) => { const v = document.querySelector(s) as HTMLVideoElement | null; return v ? [v.videoWidth, v.videoHeight, v.readyState] : null; }, sel);

test("video call rings, connects both ways, and hangs up on both sides", async ({ browser }) => {
  const ctxA = await browser.newContext({ permissions: ["camera", "microphone"] });
  const ctxB = await browser.newContext({ permissions: ["camera", "microphone"] });
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  const errors: string[] = [];
  for (const [p, n] of [[a, "A"], [b, "B"]] as const) {
    p.on("pageerror", (e) => errors.push(`${n}: ${e.message}`));
    p.on("console", (m) => /\[call\]/.test(m.text()) && console.log(n, m.text()));
  }
  await boot(a, "localhost", "a");
  await boot(b, "127.0.0.1", "b");

  await a.getByRole("button", { name: "Relationship", exact: true }).click();
  await a.getByRole("button", { name: "Message", exact: true }).click();
  await a.getByRole("button", { name: /^Video call / }).click();
  const callA = a.getByRole("dialog", { name: /^Call with / });
  await expect(callA).toBeVisible({ timeout: 15_000 });
  await expect(callA.getByRole("status")).toHaveText(/Ringing…/, { timeout: 20_000 });
  await a.screenshot({ path: "qa-logs/call-1-a-ringing.png" });

  const t0 = Date.now();
  const callB = b.getByRole("dialog", { name: /^Call with / });
  await expect(callB.getByRole("status")).toHaveText("Incoming video call", { timeout: 30_000 });
  console.log("ring reached B after", Date.now() - t0, "ms");
  await b.screenshot({ path: "qa-logs/call-2-b-incoming.png" });
  await callB.getByRole("button", { name: "Accept" }).click();

  // both sides show a running timer
  await expect(callA.getByRole("status")).toHaveText(/^\d+:\d\d$/, { timeout: 45_000 });
  await expect(callB.getByRole("status")).toHaveText(/^\d+:\d\d$/, { timeout: 45_000 });
  console.log("connected after", Date.now() - t0, "ms");
  await a.waitForTimeout(3000);
  const va = await videoSize(a, '[aria-label^="Call with"] video');
  const vb = await videoSize(b, '[aria-label^="Call with"] video');
  console.log("A remote video", JSON.stringify(va), "B remote video", JSON.stringify(vb));
  expect(va?.[0]).toBeGreaterThan(0);
  expect(vb?.[0]).toBeGreaterThan(0);
  await a.screenshot({ path: "qa-logs/call-3-a-active.png" });
  await b.screenshot({ path: "qa-logs/call-4-b-active.png" });

  const hit = await a.evaluate(() => {
    const btn = document.querySelector('[aria-label="Mute"]') as HTMLElement;
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) as HTMLElement | null;
    return { rect: [r.x, r.y, r.width, r.height], top: el ? `${el.tagName}.${el.className} z=${getComputedStyle(el).zIndex} ${el.getAttribute("aria-label") || ""} ${el.closest("[role=dialog]")?.getAttribute("aria-label") || ""}` : null, vh: innerHeight };
  });
  console.log("HIT", JSON.stringify(hit));
  // mute + camera toggles respond
  await callA.getByRole("button", { name: "Mute" }).click();
  await expect(callA.getByRole("button", { name: "Unmute" })).toBeVisible();
  await callA.getByRole("button", { name: "Camera off" }).click();
  await expect(callA.getByRole("button", { name: "Camera on" })).toBeVisible();

  // hang up from A → B ends too
  await callA.getByRole("button", { name: "End" }).click();
  await expect(callB.getByRole("status")).toHaveText(/Call ended/, { timeout: 15_000 });
  await b.screenshot({ path: "qa-logs/call-5-b-ended.png" });
  await expect(callA).toHaveCount(0, { timeout: 10_000 });
  await expect(callB).toHaveCount(0, { timeout: 10_000 });

  // Decline path: B declines a voice call → A sees "Declined"
  await a.getByRole("button", { name: /^Call Preview/ }).click();
  await expect(callB.getByRole("status")).toHaveText("Incoming call", { timeout: 30_000 });
  await callB.getByRole("button", { name: "Decline" }).click();
  await expect(callA.getByRole("status")).toHaveText("Declined", { timeout: 15_000 });
  console.log("page errors:", JSON.stringify(errors));
  expect(errors).toEqual([]);
});
