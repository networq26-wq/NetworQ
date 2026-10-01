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
    await page.getByRole("button", { name: "Events", exact: true }).last().click();
    await page.getByRole("button", { name: "Radar", exact: true }).last().click();
    await page.getByRole("button", { name: "AI Assistant" }).click();
    await expect(page.getByText("NetworQ Assistant")).toBeVisible();

    expect(await back(page)).toBe(true); // closes AI
    await expect(page.getByText("NetworQ Assistant")).toHaveCount(0);
    expect(await back(page)).toBe(true); // Radar → Events
    await expect(page.getByRole("heading", { name: "Events", exact: true })).toBeVisible();
    expect(await back(page)).toBe(true); // Events → Contacts
    await expect(page.getByText("Recent People")).toBeVisible();
    expect(await back(page)).toBe(false); // home: shell shows "press back again to exit"
  });

  test("back closes a contact's detail sheet", async ({ page }) => {
    await login(page, "asha@acme.test");
    await page.getByText("Ravi Kumar", { exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Edit contact", exact: true })).toBeVisible();
    expect(await back(page)).toBe(true);
    await expect(page.getByRole("button", { name: "Edit contact", exact: true })).toHaveCount(0);
  });

  test("phone header shows AI and Settings; no floating AI pill covering content", async ({ page }) => {
    await login(page, "asha@acme.test");
    await expect(page.getByRole("button", { name: "AI Assistant" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Profile & Settings" })).toBeVisible();
    await expect(page.getByText("AI & Voice")).toHaveCount(0);
    await page.getByRole("button", { name: "Profile & Settings" }).click();
    await expect(page.getByRole("switch", { name: "Dark mode" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  });

  test("opening Scan asks the app shell for camera permission", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__sent = [];
      (window as any).ReactNativeWebView = { postMessage: (m: string) => (window as any).__sent.push(JSON.parse(m)) };
    });
    await login(page, "asha@acme.test");
    await page.getByRole("button", { name: "Scan", exact: true }).last().click();
    await expect.poll(() => page.evaluate(() => (window as any).__sent.map((m: any) => m.type))).toContain("perm:camera");
  });
});
