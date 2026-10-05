import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("production voice endpoints with a real session", async ({ page, request }) => {
  test.setTimeout(200_000);
  await page.goto("http://localhost:8082/?devLogin=a");
  await expect(page.getByRole("button", { name: "Profile & Settings" }).first()).toBeVisible({ timeout: 120_000 });
  const token = await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.includes("auth-token")) return JSON.parse(localStorage.getItem(k) || "{}").access_token;
    return null;
  });
  expect(token).toBeTruthy();
  const H = { Authorization: `Bearer ${token}` };
  const wav = readFileSync("/private/tmp/claude-501/-Volumes-Macintosh-HD---Data-NetworQ-main/8ca26726-2240-4ffb-9927-8bf08a5a0a39/scratchpad/q.wav");
  const tr = await request.post("https://www.networq.co.in/api/transcribe", { headers: { ...H, "Content-Type": "audio/wav" }, data: wav });
  console.log("PROD transcribe", tr.status(), (await tr.text()).slice(0, 200));
  const ai = await request.post("https://www.networq.co.in/api/ai", { headers: { ...H, "Content-Type": "application/json" }, data: { messages: [{ role: "user", content: "Say hello in five words." }], max_tokens: 60, action: "chat" } });
  console.log("PROD ai", ai.status(), (await ai.text()).slice(0, 200));
  const tts = await request.post("https://www.networq.co.in/api/tts", { headers: { ...H, "Content-Type": "application/json" }, data: { text: "Hello, this is NetworQ." } });
  console.log("PROD tts", tts.status(), (await tts.text()).slice(0, 120));
});
