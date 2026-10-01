import { test, expect, login, logout, openAddContact, openContact, PASSWORD, PROFILE } from "./fixtures";

test.describe("Contacts CRUD", () => {
  test.beforeEach(async ({ db }) => {
    db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
  });

  test("save is disabled until a name is entered", async ({ page }) => {
    await login(page, "asha@acme.test");
    await openAddContact(page);
    await expect(page.getByRole("button", { name: "Save Contact" })).toBeDisabled();
    await page.getByPlaceholder("Jane Doe").fill("Ravi Kumar");
    await expect(page.getByRole("button", { name: "Save Contact" })).toBeEnabled();
  });

  test("add a contact → it is listed, stored for this user, and survives reload", async ({ page, db }) => {
    await login(page, "asha@acme.test");
    await openAddContact(page);
    await page.getByPlaceholder("Jane Doe").fill("Ravi Kumar");
    await page.getByPlaceholder("CEO, Founder, VP Engineering").fill("CTO");
    await page.getByRole("button", { name: "Save Contact" }).click();
    await expect(page.getByText("Contact saved successfully!")).toBeVisible();

    const owner = db.users[0].id;
    expect(db.rowsOwnedBy("contacts", owner)).toEqual([expect.objectContaining({ name: "Ravi Kumar", title: "CTO" })]);

    await page.getByRole("button", { name: "Close" }).click();
    await page.reload();
    await expect(page.getByText("Ravi Kumar", { exact: true }).first()).toBeVisible();
  });

  test("edit a contact → change persists", async ({ page, db }) => {
    db.table("contacts").push({ id: "c1", user_id: db.users[0].id, name: "Meera Iyer", title: "VP Sales", added_at: new Date().toISOString() });
    await login(page, "asha@acme.test");
    await openContact(page, "Meera Iyer");
    await page.getByRole("button", { name: "Edit contact", exact: true }).click();
    await page.getByPlaceholder("Jane Doe").fill("Meera Iyer-Shah");
    await page.getByRole("button", { name: "Update Contact" }).click();
    await expect(page.getByText("Contact updated!")).toBeVisible();
    expect(db.table("contacts")[0].name).toBe("Meera Iyer-Shah");

    await page.getByRole("button", { name: "Close" }).click();
    await page.reload();
    await expect(page.getByText("Meera Iyer-Shah", { exact: true }).first()).toBeVisible();
  });

  test("delete needs a second tap, then the contact is gone for good", async ({ page, db }) => {
    db.table("contacts").push({ id: "c1", user_id: db.users[0].id, name: "Old Lead", added_at: new Date().toISOString() });
    await login(page, "asha@acme.test");
    await openContact(page, "Old Lead");

    await page.getByRole("button", { name: "Delete contact" }).click();
    expect(db.table("contacts")).toHaveLength(1);

    await page.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByText("Contact deleted.")).toBeVisible();
    expect(db.table("contacts")).toHaveLength(0);

    await page.reload();
    await expect(page.getByText("Old Lead", { exact: true })).toHaveCount(0);
  });

  test("a failed delete shows an error and keeps the contact", async ({ page, db }) => {
    db.table("contacts").push({ id: "c1", user_id: db.users[0].id, name: "Keep Me", added_at: new Date().toISOString() });
    await login(page, "asha@acme.test");
    await openContact(page, "Keep Me");
    db.failNext = { method: "DELETE", table: "contacts" };
    await page.getByRole("button", { name: "Delete contact" }).click();
    await page.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByText("Simulated database failure")).toBeVisible();
    await expect(page.getByText("Contact deleted.")).toHaveCount(0);
    expect(db.table("contacts")).toHaveLength(1);
  });

  test("a failed save shows an error and stores nothing", async ({ page, db }) => {
    await login(page, "asha@acme.test");
    await openAddContact(page);
    await page.getByPlaceholder("Jane Doe").fill("Ghost");
    db.failNext = { method: "POST", table: "contacts" };
    await page.getByRole("button", { name: "Save Contact" }).click();
    await expect(page.getByText("Simulated database failure")).toBeVisible();
    expect(db.table("contacts")).toHaveLength(0);
  });
});

test("two users at once never see each other's contacts", async ({ browser, db }) => {
  db.addUser("a@acme.test", PASSWORD, { profile: { ...PROFILE, name: "User A" } });
  db.addUser("b@acme.test", PASSWORD, { profile: { ...PROFILE, name: "User B" } });

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await db.attach(ctxA);
  await db.attach(ctxB);
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await login(pageA, "a@acme.test");
  await login(pageB, "b@acme.test");

  await openAddContact(pageA);
  await pageA.getByPlaceholder("Jane Doe").fill("Secret Investor");
  await pageA.getByRole("button", { name: "Save Contact" }).click();
  await expect(pageA.getByText("Contact saved successfully!")).toBeVisible();

  await pageB.reload();
  await expect(pageB.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(pageB.getByText("Secret Investor")).toHaveCount(0);

  await logout(pageB);
  await ctxA.close();
  await ctxB.close();
});
