import { test, expect, login, PASSWORD, PROFILE } from "./fixtures";

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

test.describe("Assistant voice", () => {
  test.beforeEach(async ({ db }) => {
    db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
  });

  test("Listen plays the natural server voice clip by clip", async ({ page }) => {
    let ttsBody: any = null;
    await page.route("**/api/tts", (route) => {
      ttsBody = JSON.parse(route.request().postData() || "{}");
      return route.fulfill({ json: { voice: "diana", clips: [SILENT_WAV, SILENT_WAV] } });
    });
    await page.addInitScript(() => {
      (window as any).__played = [];
      HTMLMediaElement.prototype.play = function () {
        (window as any).__played.push(this.src.slice(0, 22));
        setTimeout(() => this.dispatchEvent(new Event("ended")), 20);
        return Promise.resolve();
      };
    });
    await login(page, "asha@acme.test");
    await page.getByRole("button", { name: "AI Assistant" }).or(page.getByRole("button", { name: /AI & Voice/ })).first().click();
    await page.getByText("Listen").first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__played.length)).toBe(2);
    expect(ttsBody.text).toMatch(/NetworQ/);
  });

  test("without the server voice, the device's female voice is used (not a male/robotic default)", async ({ page }) => {
    await page.route("**/api/tts", (route) => route.fulfill({ status: 503, json: { error: "Natural voice unavailable" } }));
    await page.addInitScript(() => {
      const voices = [
        { name: "Google UK English Male", lang: "en-GB" },
        { name: "Daniel", lang: "en-GB" },
        { name: "Samantha", lang: "en-US" },
      ];
      (window as any).__spoken = [];
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
        getVoices: () => voices,
        cancel() {},
        speak(u: any) {
          (window as any).__spoken.push(u.voice?.name);
          setTimeout(() => u.onend && u.onend(), 10);
        },
        onvoiceschanged: null,
      } });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: function (this: any, t: string) {
        this.text = t;
      } });
    });
    await login(page, "asha@acme.test");
    await page.getByRole("button", { name: "AI Assistant" }).or(page.getByRole("button", { name: /AI & Voice/ })).first().click();
    await page.getByText("Listen").first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toEqual(["Samantha"]);
  });
});
