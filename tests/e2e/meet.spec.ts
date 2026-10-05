import { test, expect, login, PASSWORD, PROFILE } from "./fixtures";

// Scheduling a call: pasted link + calendar invite (.ics) attached to the email; the link is remembered.
test("schedule a call with a pasted meeting link sends an email with a calendar invite", async ({ page, db, sentEmails }) => {
  const u = db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
  db.table("contacts").push({ id: "c1", user_id: u.id, name: "Ravi Kumar", email: "ravi@kumar.test", added_at: new Date().toISOString() });
  await login(page, "asha@acme.test");
  await page.getByText("Ravi Kumar", { exact: true }).first().click();
  await page.getByRole("button", { name: "Meet", exact: true }).last().click();

  const tomorrow = new Date(Date.now() + 86400000);
  const ymd = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  await page.locator('input[type="date"]').fill(ymd);
  await page.locator('input[type="time"]').fill("10:30");
  await page.getByRole("radio", { name: "45 min" }).click();
  await page.getByRole("radio", { name: "Paste link" }).click();
  await page.getByLabel("Meeting link").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(/Paste a valid meeting link/)).toBeVisible();
  expect(sentEmails).toHaveLength(0);

  await page.getByLabel("Meeting link").fill("meet.google.com/abc-defg-hij");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invite sent")).toBeVisible();
  await expect(page.getByText("https://meet.google.com/abc-defg-hij").first()).toBeVisible();

  const mail = sentEmails[0];
  expect(mail.to).toBe("ravi@kumar.test");
  expect(mail.body).toContain("Join: https://meet.google.com/abc-defg-hij");
  expect(mail.body).toContain("45-minute call");
  expect(mail.ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
  expect(mail.ics).toContain("METHOD:REQUEST");
  expect(mail.ics.replace(/\r\n /g, "")).toContain("mailto:ravi@kumar.test");
  const row = db.table("meetings")[0];
  expect(row).toMatchObject({ contact_id: "c1", meet_link: "https://meet.google.com/abc-defg-hij", meet_time: "10:30" });
  expect(await page.evaluate(() => localStorage.getItem("networq.meet.link"))).toBe("https://meet.google.com/abc-defg-hij");
});
