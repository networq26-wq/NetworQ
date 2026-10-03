import { test, expect, login, PASSWORD, PROFILE, isMobileProject } from "./fixtures";

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
    await expect(page.getByText(/Event Radar|Live at/).first()).toBeVisible();
    expect(db.table("notifications").find((n) => n.id === "n1")!.read_at).toBeTruthy();
    await expect(page.getByRole("button", { name: "Notifications & Reminders" })).toBeVisible();
  });

  test("empty state", async ({ page, db }) => {
    db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
    await login(page, "asha@acme.test");
    await page.getByRole("button", { name: "Notifications & Reminders" }).click();
    await expect(page.getByText("You're all caught up.")).toBeVisible();
  });
});
