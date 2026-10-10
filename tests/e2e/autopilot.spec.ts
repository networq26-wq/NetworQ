import { test, expect, login, PASSWORD, PROFILE } from "./fixtures";

test.describe("Follow-up autopilot", () => {
  test.beforeEach(async ({ db }) => {
    const me = db.addUser("asha@acme.test", PASSWORD, { profile: { ...PROFILE, autopilot_enabled: false, autopilot_days: [1, 7, 30] } });
    const tomorrow = new Date(Date.now() + 864e5).toISOString();
    db.table("contacts").push({ id: "c1", user_id: me.id, name: "Ravi Kumar", email: "ravi@kumar.test", company: "Kumar AI", added_at: new Date().toISOString(), autopilot_status: "active", autopilot_step: 0, autopilot_next_at: tomorrow });
    db.table("contacts").push({ id: "c2", user_id: me.id, name: "No Email Person", added_at: new Date().toISOString(), autopilot_status: "active", autopilot_step: 0, autopilot_next_at: tomorrow });
  });

  test("one tap on People turns it on; the card then shows what's coming", async ({ page, db }) => {
    await login(page, "asha@acme.test");
    await expect(page.getByRole("heading", { name: "Put your follow-ups on autopilot" })).toBeVisible();
    await page.getByRole("button", { name: "Turn on", exact: true }).click();
    await expect(page.getByText("Autopilot is on", { exact: true })).toBeVisible();
    await expect(page.getByText(/1 follow-up this week · next: Ravi, tomorrow/)).toBeVisible();
    expect(db.autopilotCalls.at(-1)).toMatchObject({ p_enabled: true });
  });

  test("settings: switch, schedule and signature are saved", async ({ page, db }) => {
    await login(page, "asha@acme.test");
    await page.getByRole("button", { name: "See how it works" }).click();
    await expect(page.getByRole("heading", { name: "Follow-up autopilot" })).toBeVisible();
    const sw = page.getByRole("switch", { name: "Send my follow-ups automatically" });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: /Day 1 and 14/ }).click();
    await expect(page.getByRole("radio", { name: /Day 1 and 14/ })).toHaveAttribute("aria-checked", "true");
    expect(db.autopilotCalls.at(-1)).toMatchObject({ p_enabled: true, p_days: [1, 14] });
    await page.getByRole("textbox", { name: "Signature" }).fill("Asha · acme.io");
    await page.getByRole("button", { name: "Save signature" }).click();
    await expect.poll(() => db.autopilotCalls.at(-1)?.p_signature).toBe("Asha · acme.io");
    await expect(page.getByText("Ravi Kumar").first()).toBeVisible(); // coming up
  });

  test("in a contact: pause, they replied, resume; no email → explains why", async ({ page }) => {
    await login(page, "asha@acme.test");
    await page.getByText("Ravi Kumar", { exact: true }).first().click();
    const group = page.getByRole("group", { name: "Follow-up autopilot for this person" });
    await expect(group).toContainText("Next follow-up tomorrow");
    await group.getByRole("button", { name: "They replied" }).click();
    await expect(group).toContainText("They replied — follow-ups stopped.");
    await group.getByRole("button", { name: "Resume" }).click();
    await expect(group).toContainText("Next follow-up");
    await group.getByRole("button", { name: "Pause" }).click();
    await expect(group).toContainText("Follow-ups paused for this person.");
    await page.getByRole("button", { name: "Close" }).last().click();
    await page.getByText("No Email Person", { exact: true }).first().click();
    await expect(page.getByRole("group", { name: "Follow-up autopilot for this person" })).toContainText("needs an email address");
  });
});
