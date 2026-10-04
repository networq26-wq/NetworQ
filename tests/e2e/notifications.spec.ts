import { test, expect, login, logout, PASSWORD, PROFILE, isMobileProject } from "./fixtures";

test.describe("Notifications & blocking", () => {
  test("bell shows unread count; centre lists items; tapping opens the right screen and marks read", async ({ page, db }) => {
    const u = db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
    db.table("notifications").push(
      { id: "n1", user_id: u.id, type: "connection_request", title: "Bob Iyer wants to connect", body: "At Founders Night.", data: { screen: "radar" }, read_at: null, created_at: new Date().toISOString() },
      { id: "n2", user_id: u.id, type: "connection_accepted", title: "Cara accepted your request", body: "", data: { screen: "contacts" }, read_at: new Date().toISOString(), created_at: new Date(Date.now() - 3600_000).toISOString() }
    );
    await login(page, "asha@acme.test");
    const bell = page.getByRole("button", { name: "Notifications, 1 unread" });
    await expect(bell).toBeVisible();
    await bell.click();
    const centre = page.getByRole("dialog", { name: "Notifications" });
    await expect(centre.getByText("Bob Iyer wants to connect")).toBeVisible();
    await expect(centre.getByText("Cara accepted your request")).toBeVisible();
    await centre.getByText("Bob Iyer wants to connect").click();
    await expect(page.getByRole("tablist", { name: "Radar mode" })).toBeVisible(); // landed on Radar
    expect(db.table("notifications").find((n) => n.id === "n1")!.read_at).toBeTruthy();
    await expect(page.getByRole("button", { name: "Notifications & Reminders" })).toBeVisible();
  });

  test("empty state", async ({ page, db }) => {
    db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
    await login(page, "asha@acme.test");
    await page.getByRole("button", { name: "Notifications & Reminders" }).click();
    await expect(page.getByText("You're all caught up.")).toBeVisible();
  });

  test("Android app: turn on push from the notification centre; the device detaches on sign-out and re-attaches on sign-in", async ({ page, db }) => {
    db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
    // Fake Android shell answering the push bridge like shell/pushBridge.ts
    await page.addInitScript(() => {
      const w = window as any;
      w.__NETWORQ_SHELL__ = { push: true };
      w.__pushAsks = [] as any[];
      w.ReactNativeWebView = {
        postMessage(raw: string) {
          const msg = JSON.parse(raw);
          if (msg.type !== "push:register") return;
          w.__pushAsks.push(msg.prompt);
          const granted = msg.prompt || localStorage.getItem("fake-granted") === "1";
          if (granted) localStorage.setItem("fake-granted", "1");
          setTimeout(() => window.dispatchEvent(new CustomEvent("networq-native", { detail: { type: "push:token", token: granted ? "ExponentPushToken[device-1]" : null, permission: granted ? "granted" : "undetermined" } })), 20);
        },
      };
    });
    await login(page, "asha@acme.test");
    const me = db.users[0].id;
    await page.getByRole("button", { name: /^Notifications/ }).first().click();
    const card = page.getByRole("region", { name: "Turn on notifications" });
    await expect(card.getByText("Get notified on this phone")).toBeVisible();
    await card.getByRole("button", { name: "Turn on" }).click();
    await expect(page.getByText("Notifications are on.")).toBeVisible();
    expect(db.pushTokens).toEqual([{ token: "ExponentPushToken[device-1]", user_id: me, platform: "android" }]);
    await expect(card).toHaveCount(0);

    await page.keyboard.press("Escape");
    await logout(page);
    expect(db.pushTokens).toEqual([]); // next person on this phone won't get Asha's notifications

    await login(page, "asha@acme.test");
    await expect.poll(() => db.pushTokens.length).toBe(1); // silently re-attached, no second permission prompt
    const asks = await page.evaluate(() => (window as any).__pushAsks as boolean[]);
    expect(asks.length).toBeGreaterThan(0);
    expect(asks.every((prompt) => prompt === false)).toBe(true); // re-attach never shows a permission dialog
  });

  test("Settings shows the push switch; browsers without push support say so", async ({ page, db }) => {
    db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
    await page.addInitScript(() => {
      delete (window as any).PushManager;
    });
    await login(page, "asha@acme.test");
    await page.getByTitle("Profile & Settings").click();
    await page.getByRole("button", { name: "Notifications", exact: true }).click(); // settings are sub-pages of Me
    const sw = page.getByRole("switch", { name: "Push notifications" });
    await expect(sw).toBeDisabled();
    await expect(page.getByText(/This browser can't receive notifications/)).toBeVisible();
  });
});

