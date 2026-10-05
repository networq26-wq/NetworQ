import { test, expect } from "@playwright/test";
const WAV = "/private/tmp/claude-501/-Volumes-Macintosh-HD---Data-NetworQ-main/8ca26726-2240-4ffb-9927-8bf08a5a0a39/scratchpad/q.wav";
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`, "--autoplay-policy=no-user-gesture-required"] } });
test("AI voice assistant loop", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  const page = await ctx.newPage();
  const log: string[] = [];
  page.on("response", async (r) => {
    const u = r.url();
    if (/\/api\/(transcribe|ai|tts)/.test(u)) {
      let body = "";
      try { body = (await r.text()).slice(0, 160); } catch {}
      log.push(`${r.status()} ${u.split("/api/")[1]} ${body.replace(/data:audio[^"]{0,40}[^"]*/g, "data:audio…")}`);
    }
  });
  page.on("console", (m) => /speech|voice|tts|error/i.test(m.text()) && log.push("console: " + m.text().slice(0, 160)));
  page.on("pageerror", (e) => log.push("PAGEERROR " + e.message));
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("http://localhost:8082/?devLogin=a");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "AI Assistant" }).click();
  await page.waitForTimeout(800);
  const mic = page.getByTitle(/Speak to Assistant|Stop Listening/).first();
  await mic.click();
  await page.waitForTimeout(4500);
  await page.screenshot({ path: "qa-logs/aivoice-1.png" });
  await page.getByTitle(/Stop Listening/).first().click().catch(() => log.push("no stop button"));
  await page.waitForTimeout(20000);
  await page.screenshot({ path: "qa-logs/aivoice-2.png" });
  console.log(log.join("\n"));
});
