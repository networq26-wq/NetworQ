import { test, expect } from "./fixtures";

// The Android app's WebView can't open new windows, so in the app window.open and target=_blank
// links navigate instead (the shell then hands other sites / files to the phone).
test.describe("New-window links inside the Android app", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => ((window as any).ReactNativeWebView = { postMessage() {} }));
    await page.route("https://example.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>outside</title>outside" }));
  });

  test("window.open navigates instead of silently doing nothing", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.open("https://example.test/file.pdf", "_blank", "noopener"));
    await expect(page).toHaveURL("https://example.test/file.pdf");
  });

  test("target=_blank links navigate; links whose click is handled by the app are left alone", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const handled = document.createElement("a");
      handled.href = "https://example.test/handled";
      handled.target = "_blank";
      handled.textContent = "handled";
      handled.addEventListener("click", (e) => e.preventDefault());
      const plain = document.createElement("a");
      plain.href = "https://example.test/event";
      plain.target = "_blank";
      plain.textContent = "plain";
      document.body.append(handled, plain);
    });
    await page.getByText("handled", { exact: true }).click();
    await expect(page).not.toHaveURL(/example\.test/);
    await page.getByText("plain", { exact: true }).click();
    await expect(page).toHaveURL("https://example.test/event");
  });

  test("in a normal browser window.open is untouched", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");
    expect(await page.evaluate(() => window.open.toString().includes("[native code]"))).toBe(true);
    await ctx.close();
  });
});
