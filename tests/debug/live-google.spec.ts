import { test } from "@playwright/test";
test.use({ baseURL: "https://www.networq.co.in" });
for (const ua of [["browser", undefined], ["android-webview", "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36"]] as const) {
  test(`google button (${ua[0]})`, async ({ browser }) => {
    const ctx = await browser.newContext(ua[1] ? { userAgent: ua[1], viewport: { width: 412, height: 900 } } : {});
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
    page.on("pageerror", (e) => errs.push("pageerror " + e.message.slice(0, 200)));
    await page.goto("/");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.waitForURL(/accounts\.google\.com|error/, { timeout: 15000 }).catch(() => {});
    console.log(`[${ua[0]}] landed on: ${page.url().slice(0, 140)}`);
    console.log(`[${ua[0]}] title: ${await page.title()}`);
    const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 300).replace(/\n+/g, " | ");
    console.log(`[${ua[0]}] page text: ${body}`);
    console.log(`[${ua[0]}] errors: ${JSON.stringify(errs)}`);
    await ctx.close();
  });
}
