import { test, expect, login, PASSWORD, PROFILE, isMobileProject } from "./fixtures";

const back = (page: import("@playwright/test").Page) => page.evaluate(() => (window as any).__networqHandleBack());

test.describe("Android app behaviour", () => {
  test.beforeEach(async ({ page, db }) => {
    test.skip(!isMobileProject(), "phone layout");
    await page.addInitScript(() => ((window as any).ReactNativeWebView = { postMessage() {} }));
    const u = db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
    db.table("contacts").push({ id: "c1", user_id: u.id, name: "Ravi Kumar", added_at: new Date().toISOString() });
  });

  test("hardware back closes overlays, then walks back through tabs, then lets the app exit", async ({ page }) => {
    await login(page, "asha@acme.test");
    await page.getByRole("button", { name: "Radar", exact: true }).last().click();
    await page.getByRole("button", { name: "Events", exact: true }).last().click();
    await page.getByRole("button", { name: "AI Assistant" }).click(); // the quiet AI button shows on People, Messages, Events
    await expect(page.getByText("NetworQ Assistant")).toBeVisible();

    expect(await back(page)).toBe(true); // closes AI
    await expect(page.getByText("NetworQ Assistant")).toHaveCount(0);
    expect(await back(page)).toBe(true); // Events → Radar
    await expect(page.getByRole("button", { name: "AI Assistant" })).toHaveCount(0);
    expect(await back(page)).toBe(true); // Radar → People
    await expect(page.getByText("Your people")).toBeVisible();
    expect(await back(page)).toBe(false); // home: shell shows "press back again to exit"
  });

  test("back closes a contact's detail sheet", async ({ page }) => {
    await login(page, "asha@acme.test");
    await page.getByText("Ravi Kumar", { exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Edit contact", exact: true })).toBeVisible();
    expect(await back(page)).toBe(true);
    await expect(page.getByRole("button", { name: "Edit contact", exact: true })).toHaveCount(0);
  });

  test("one way into Me (header avatar); settings live on their own pages; quiet AI button", async ({ page }) => {
    await login(page, "asha@acme.test");
    await expect(page.getByRole("button", { name: "AI Assistant" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("button", { name: "Me", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Profile & Settings" }).click();
    await expect(page.getByRole("button", { name: "Profile & Settings" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: /^Appearance/ }).click();
    await expect(page.getByRole("switch", { name: "Dark mode" })).toBeVisible();
    await page.getByRole("button", { name: "Back to Me" }).click();
    await page.getByRole("button", { name: /^Account/ }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  });

  test("select several people, then email them all at once", async ({ page, db }) => {
    const owner = db.table("contacts")[0].user_id;
    db.table("contacts").push({ id: "c2", user_id: owner, name: "Lena Park", email: "lena@seed.test", added_at: new Date().toISOString() });
    await login(page, "asha@acme.test");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: /^Select all/ }).click();
    const bar = page.getByRole("toolbar", { name: "Selected people" });
    await expect(bar.getByText("2 selected")).toBeVisible();
    await expect(bar.getByText("1 without email.", { exact: false })).toBeVisible();
    await bar.getByRole("button", { name: /^Email 1/ }).click();
    await expect(page.getByText("Follow-up emails")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send 1 email" })).toBeVisible();
  });

  test("opening Scan asks the app shell for camera permission", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__sent = [];
      (window as any).ReactNativeWebView = { postMessage: (m: string) => (window as any).__sent.push(JSON.parse(m)) };
    });
    await login(page, "asha@acme.test");
    await page.getByRole("button", { name: "Scan a card", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__sent.map((m: any) => m.type))).toContain("perm:camera");
  });

  test("back closes every sheet and screen in order, and only exits from home", async ({ page }) => {
    await login(page, "asha@acme.test");
    const home = page.getByText("Your people");
    const step = async (open: () => Promise<void>, visible: import("@playwright/test").Locator, label: string) => {
      await open();
      await expect(visible, `${label} opened`).toBeVisible();
      expect(await back(page), `${label}: back handled`).toBe(true);
      await expect(visible, `${label}: closed by back`).toHaveCount(0);
    };
    await step(() => page.getByRole("button", { name: "AI Assistant" }).click(), page.getByText("NetworQ Assistant"), "AI sheet");
    await step(() => page.getByRole("button", { name: /^Notifications/ }).first().click(), page.getByRole("dialog", { name: "Notifications" }), "notifications");
    await step(() => page.getByRole("button", { name: "Open Ravi Kumar" }).first().click(), page.getByRole("button", { name: "Edit contact", exact: true }), "contact sheet");
    await step(() => page.getByRole("button", { name: "Voice note" }).click(), page.getByText("Voice note", { exact: true }).last(), "voice note");
    await step(() => page.getByRole("button", { name: "Select", exact: true }).click(), page.getByRole("toolbar", { name: "Selected people" }), "select mode");
    await step(() => page.getByRole("button", { name: "Scan a card" }).click(), page.getByRole("dialog", { name: "Card camera" }), "camera");

    // Me → sub-page → back to Me → back to People
    await page.getByRole("button", { name: "Profile & Settings" }).click();
    await page.getByRole("button", { name: /^Appearance/ }).click();
    await expect(page.getByRole("button", { name: "Back to Me" })).toBeVisible();
    expect(await back(page)).toBe(true);
    await expect(page.getByRole("button", { name: "Back to Me" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Appearance/ })).toBeVisible();
    expect(await back(page)).toBe(true);
    await expect(home).toBeVisible();

    // Tabs: People → Messages → Events → back → Messages → back → People → back = exit (handled false)
    await page.getByRole("button", { name: "Messages", exact: true }).last().click();
    await page.getByRole("button", { name: "Events", exact: true }).last().click();
    expect(await back(page)).toBe(true);
    await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
    expect(await back(page)).toBe(true);
    await expect(home).toBeVisible();
    expect(await back(page)).toBe(false);
  });
});
