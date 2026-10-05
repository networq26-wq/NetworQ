import type { Page } from "@playwright/test";
import { test, expect, login, gotoLogin, PASSWORD, PROFILE } from "./fixtures";

// Settings live under Me, one topic per page: tap your avatar, then the row
const ROW: Record<string, RegExp> = {
  profile: /^Profile Name/, security: /^Password & devices/, notifications: /^Notifications/, appearance: /^Appearance/,
  privacy: /^Privacy & blocking/, help: /^Help & about/, account: /^Account/,
};
async function openSettings(page: Page, section: keyof typeof ROW) {
  const back = page.getByRole("button", { name: "Back to Me" });
  if (await back.count()) await back.click();
  else await page.getByTitle("Profile & Settings").first().click();
  await page.getByRole("button", { name: ROW[section] }).last().click(); // rows come after the header buttons
  await expect(page.getByRole("button", { name: "Back to Me" })).toBeVisible();
}

test.describe("Settings & account security", () => {
  test.beforeEach(async ({ db }) => {
    db.addUser("asha@acme.test", PASSWORD, { profile: { ...PROFILE, notification_prefs: { login_alerts: true, reminder_emails: true, product_updates: false } } });
  });

  test("password fields have a working show/hide toggle", async ({ page }) => {
    await gotoLogin(page);
    const field = page.getByLabel("Password", { exact: true });
    await field.fill("secret123");
    await expect(field).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(field).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(field).toHaveAttribute("type", "password");
  });

  test("sign-in is reported once per session for welcome / new-device emails", async ({ page, accountCalls }) => {
    await login(page, "asha@acme.test");
    await expect.poll(() => accountCalls.filter((c) => c.path.endsWith("/auth/session-event")).length).toBe(1);
    expect(accountCalls[0].body).toEqual({ type: "signed_in" });
    await page.reload();
    await expect(page.getByRole("button", { name: "Profile & Settings" })).toBeVisible();
    await page.waitForTimeout(500);
    expect(accountCalls.filter((c) => c.path.endsWith("/auth/session-event"))).toHaveLength(1);
  });

  test("profile edits save", async ({ page, db }) => {
    await login(page, "asha@acme.test");
    await openSettings(page, "profile");
    await page.getByLabel("Role / title").fill("CEO");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    expect(db.table("profiles")[0].role).toBe("CEO");
  });

  test("profile photo uploads to the user's own folder", async ({ page, db }) => {
    await login(page, "asha@acme.test");
    await openSettings(page, "profile");
    // 2×2 PNG
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP8z8DwnwEJMCJzAEoCAgEaFpt/AAAAAElFTkSuQmCC", "base64");
    await page.getByLabel("Upload profile photo").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("Photo updated.")).toBeVisible();
    expect(db.uploads[0]).toBe(`avatars/${db.users[0].id}/avatar.jpg`);
    expect(db.table("profiles")[0].avatar_url).toContain(`/avatars/${db.users[0].id}/avatar.jpg`);
    await expect(page.getByRole("img", { name: "Your profile photo" })).toBeVisible();
  });

  test("change password: wrong current password is refused; correct one works and notifies", async ({ page, db, accountCalls }) => {
    await login(page, "asha@acme.test");
    await openSettings(page, "security");
    await page.getByLabel("Current password").fill("wrong-password");
    await page.getByLabel("New password", { exact: true }).fill("BrandNewPass9");
    await page.getByLabel("Confirm new password").fill("BrandNewPass9");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Current password is incorrect.")).toBeVisible();
    expect(db.users[0].password).toBe(PASSWORD);

    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Password changed. We've emailed you a confirmation.")).toBeVisible();
    expect(db.users[0].password).toBe("BrandNewPass9");
    await expect.poll(() => accountCalls.some((c) => c.body?.type === "password_changed")).toBe(true);
  });

  test("change password validates length and match", async ({ page }) => {
    await login(page, "asha@acme.test");
    await openSettings(page, "security");
    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByLabel("Confirm new password").fill("short");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("New password must be at least 8 characters.")).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill("LongEnough99");
    await page.getByLabel("Confirm new password").fill("Different99");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("New passwords don't match.")).toBeVisible();
  });

  test("change email sends a confirmation", async ({ page, db }) => {
    await login(page, "asha@acme.test");
    await openSettings(page, "security");
    await page.getByLabel("New email address").fill("asha@newco.test");
    await page.getByRole("button", { name: "Send confirmation" }).click();
    await expect(page.getByText(/Check asha@newco.test/)).toBeVisible();
    expect((db.users[0] as any).pendingEmail).toBe("asha@newco.test");
  });

  test("notification preferences persist", async ({ page, db }) => {
    await login(page, "asha@acme.test");
    await openSettings(page, "notifications");
    const toggle = page.getByRole("switch", { name: "New sign-in alerts" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => db.table("profiles")[0].notification_prefs.login_alerts).toBe(false);
    await page.waitForTimeout(500);
    await expect(toggle).toHaveAttribute("aria-checked", "false"); // not reverted by a failed save
  });

  test("sign out of all devices revokes every session", async ({ page, db }) => {
    await login(page, "asha@acme.test");
    await openSettings(page, "security");
    await page.getByRole("button", { name: "Sign out of all devices" }).click();
    await expect(page.getByText("Signed out of all devices.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
    expect(db.sessionsRevoked).toBe(1);
  });

  test("delete account: needs DELETE, schedules, signs out; signing back in offers cancel", async ({ page, db }) => {
    await login(page, "asha@acme.test");
    await openSettings(page, "account");
    const del = page.getByRole("button", { name: "Delete my account" });
    await expect(del).toBeDisabled();
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await del.click();
    await expect(page.getByText(/Account scheduled for deletion on/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
    expect(db.table("profiles")[0].deletion_scheduled_at).toBeTruthy();

    await login(page, "asha@acme.test");
    const banner = page.getByRole("alert").filter({ hasText: "scheduled for deletion" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Cancel deletion" }).click();
    await expect(page.getByText("Deletion cancelled. Welcome back!")).toBeVisible();
    expect(db.table("profiles")[0].deletion_scheduled_at).toBeNull();
  });

  test("blocked people can be unblocked; devices, connection emails, vibration and version are shown", async ({ page, db }) => {
    const bob = db.addUser("bob@acme.test", PASSWORD, { profile: { name: "Bob Iyer" } });
    await login(page, "asha@acme.test");
    const me = db.users.find((u) => u.email === "asha@acme.test")!;
    db.blocks.push({ blocker: me.id, blocked: bob.id });
    db.table("login_devices").push({ user_id: me.id, device_hash: "a".repeat(64), user_agent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36", first_seen: "2026-09-01T10:00:00Z", last_seen: "2026-10-02T09:00:00Z" });
    await openSettings(page, "privacy");

    const blocked = page.getByRole("list", { name: "Blocked people" });
    await expect(blocked.getByText("Bob Iyer")).toBeVisible();
    await blocked.getByRole("button", { name: "Unblock Bob Iyer" }).click();
    await expect(page.getByText("You haven't blocked anyone.")).toBeVisible();
    expect(db.blocks).toHaveLength(0);

    await openSettings(page, "security");
    await expect(page.getByRole("list", { name: "Recent devices" }).getByText("Chrome on Android")).toBeVisible();

    await openSettings(page, "notifications");
    const conn = page.getByRole("switch", { name: "Connection emails" });
    await expect(conn).toHaveAttribute("aria-checked", "true");
    await conn.click();
    await expect.poll(() => db.table("profiles").find((p) => p.id === me.id)!.notification_prefs.connection_emails).toBe(false);

    await openSettings(page, "appearance");
    const vib = page.getByRole("switch", { name: "Vibration" });
    await expect(vib).toHaveAttribute("aria-checked", "true");
    await vib.click();
    await expect(vib).toHaveAttribute("aria-checked", "false");
    expect(await page.evaluate(() => localStorage.getItem("networq.haptics"))).toBe("off");

    await openSettings(page, "help");
    await expect(page.getByLabel("App version")).toContainText("1.0.0");
    await expect(page.getByText(/^Online · /)).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact support" })).toHaveAttribute("href", /^mailto:support@networq\.co\.in/);
  });

  test("privacy, terms and delete-account pages are reachable", async ({ page }) => {
    await gotoLogin(page);
    await expect(page.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    for (const [path, heading] of [["/privacy", "Privacy Policy"], ["/terms", "Terms of Service"], ["/delete-account", "Delete your NetworQ account"]]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });
});
