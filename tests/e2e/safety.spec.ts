import { test, expect, login, PASSWORD, PROFILE } from "./fixtures";

// Google Play requires in-app reporting and blocking for chat (user-generated content policy)
// and in-app reporting of AI answers (AI-generated content policy).
test.describe("Safety: report and block", () => {
  test("in a chat: report a message (and block), or block from the menu; blocked people can't message", async ({ page, db }) => {
    const me = db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
    const bob = db.addUser("bob@acme.test", PASSWORD, { profile: { name: "Bob Iyer", company: "Iyer Labs", role: "Founder" } });
    db.table("contacts").push({ id: "c1", user_id: me.id, name: "Bob Iyer", linked_user_id: bob.id, added_at: new Date().toISOString() });
    await login(page, "asha@acme.test");
    // Bob already sent something nasty
    const pair = [me.id, bob.id].sort().join(":");
    db.table("chats").push({ id: "chat-1", pair });
    db.table("chat_messages").push({ id: "m1", chat_id: "chat-1", sender_id: bob.id, recipient_id: me.id, content: "you are useless", status: "sent", created_at: new Date().toISOString() });

    await page.getByRole("button", { name: "Messages", exact: true }).last().click();
    await page.getByRole("button", { name: /New message/ }).first().click();
    await page.getByText("Bob Iyer", { exact: true }).last().click();
    await expect(page.getByText("you are useless")).toBeVisible();

    // Report the message
    await page.getByRole("button", { name: "Report this message" }).click();
    const sheet = page.getByRole("dialog", { name: "Report" });
    await expect(sheet.getByRole("heading", { name: "Report this message" })).toBeVisible();
    await sheet.getByRole("button", { name: "Send report" }).click();
    await expect(sheet.getByRole("alert")).toHaveText("Choose what's wrong.");
    await sheet.getByRole("radio", { name: "Harassment or bullying" }).check();
    await sheet.getByLabel("Anything else? (optional)").fill("keeps doing this");
    await expect(sheet.getByRole("checkbox", { name: "Also block Bob Iyer" })).toBeChecked();
    await sheet.getByRole("checkbox", { name: "Also block Bob Iyer" }).uncheck();
    await sheet.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("Report sent. Thank you — we'll review it.")).toBeVisible();
    expect(db.table("content_reports")[0]).toMatchObject({ kind: "message", reason: "harassment", target_user: bob.id, message_id: "m1", content: "you are useless", details: "keeps doing this", reporter: me.id });
    expect(db.blocks).toHaveLength(0);

    // Block from the menu
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("menuitem", { name: "Block Bob Iyer" }).click();
    await expect(page.getByText("Bob Iyer is blocked.")).toBeVisible();
    expect(db.blocks).toEqual([{ blocker: me.id, blocked: bob.id }]);
  });

  test("every AI answer can be reported from inside the app", async ({ page, db }) => {
    db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
    await page.route("**/api/ai", (route) => route.fulfill({ json: { reply: "Here is a bad answer." } }));
    await page.route("**/api/chat", (route) => route.fulfill({ json: { reply: "Here is a bad answer." } }));
    await login(page, "asha@acme.test");
    await page.getByRole("button", { name: "AI Assistant" }).click();
    await page.getByPlaceholder("Ask about your contacts…").fill("say something");
    await page.keyboard.press("Enter");
    const reportBtn = page.getByRole("button", { name: "Report this AI answer" }).last();
    await expect(reportBtn).toBeVisible({ timeout: 15000 });
    await reportBtn.click();
    const sheet = page.getByRole("dialog", { name: "Report" });
    await expect(sheet.getByRole("heading", { name: "Report this AI answer" })).toBeVisible();
    await expect(sheet.getByRole("checkbox")).toHaveCount(0); // nobody to block
    await sheet.getByRole("radio", { name: "Dangerous or harmful" }).check();
    await sheet.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText(/Report sent/)).toBeVisible();
    expect(db.table("content_reports")[0]).toMatchObject({ kind: "ai", reason: "harmful" });
    expect(String(db.table("content_reports")[0].content).length).toBeGreaterThan(0);
  });

  test("sign-up says you agree to the Terms before you can create anything", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create Account", { exact: true }).click();
    await expect(page.getByText(/By continuing, you agree to NetworQ's/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms" }).first()).toHaveAttribute("href", "/terms");
  });
});
