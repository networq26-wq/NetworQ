import { test, expect, login, openPeople, isMobileProject, PASSWORD, PROFILE } from "./fixtures";

test.describe("Who's next stays up to date", () => {
  test("an email sent elsewhere (autopilot, another device) clears 'overdue' when you come back to the app", async ({ page, db }) => {
    const u = db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    db.table("contacts").push({ id: "c1", user_id: u.id, name: "Abhilash Rao", email: "abhilash@x.test", added_at: new Date(Date.now() - 20 * 864e5).toISOString(), reminder: "Follow up", reminder_date: yesterday, reminder_done: false });
    await login(page, "asha@acme.test");
    const next = page.getByRole("region", { name: "Who's next" });
    await expect(next.getByText(/Follow-up overdue/)).toBeVisible();

    // the server sends the follow-up while the app is in the background
    Object.assign(db.table("contacts")[0], { email_sent: true, reminder_done: true });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText(/Follow-up overdue/)).toHaveCount(0);
    await expect(page.getByText("Abhilash Rao", { exact: true })).toHaveCount(0);
  });

  test("Ask AI never covers the page: in the tab bar row on phones, a pill that hides while scrolling on desktop", async ({ page, db }) => {
    const u = db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
    for (let i = 0; i < 30; i++) db.table("contacts").push({ id: `c${i}`, user_id: u.id, name: `Person ${i}`, email: `p${i}@x.test`, added_at: new Date(Date.now() - i * 864e5).toISOString() });
    await login(page, "asha@acme.test");
    const ai = page.getByRole("button", { name: "AI Assistant" });
    await expect(ai).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: "AI Assistant" })).toHaveCount(0); // not in the top bar
    const vp = page.viewportSize()!;
    if (isMobileProject()) {
      const nav = (await page.getByRole("navigation", { name: "Main navigation" }).boundingBox())!;
      const b = (await ai.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(nav.x + nav.width); // beside the tabs, not on the page
      expect(Math.abs(b.y + b.height / 2 - (nav.y + nav.height / 2))).toBeLessThan(4); // same row
    } else {
      const box = (await ai.boundingBox())!;
      expect(box.y).toBeGreaterThan(vp.height * 0.7);
      await openPeople(page);
      await page.mouse.move(vp.width / 2, vp.height / 2);
      await page.mouse.wheel(0, 600);
      await expect(ai).toHaveCSS("opacity", "0"); // scrolling down: it vanishes
      await expect(ai).toHaveCSS("opacity", "1", { timeout: 4000 }); // …and returns once you stop
    }
    await ai.click();
    await expect(page.getByText("NetworQ Assistant")).toBeVisible();
  });
});
