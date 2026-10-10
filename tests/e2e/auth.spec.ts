import { test, expect, gotoLogin, login, logout, signOutButton, PASSWORD, PROFILE } from "./fixtures";

test.describe("Authentication", () => {
  test("splash hands off to the login screen quickly", async ({ page }) => {
    const start = Date.now();
    await gotoLogin(page);
    expect(Date.now() - start).toBeLessThan(8_000);
  });

  test("wrong password shows a clear error and stays logged out", async ({ page, db }) => {
    db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
    await gotoLogin(page);
    await page.getByPlaceholder("name@company.com").fill("asha@acme.test");
    await page.locator('input[type="password"]').fill("wrong-password");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await expect(signOutButton(page)).toHaveCount(0);
  });

  test("unknown account gets the same generic error", async ({ page }) => {
    await gotoLogin(page);
    await page.getByPlaceholder("name@company.com").fill("nobody@acme.test");
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
  });

  test("unconfirmed email is told to confirm", async ({ page, db }) => {
    db.addUser("new@acme.test", PASSWORD, { confirmed: false });
    await gotoLogin(page);
    await page.getByPlaceholder("name@company.com").fill("new@acme.test");
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByText("Please confirm your email address before signing in.")).toBeVisible();
  });

  test("login, session survives reload, logout, stays logged out after reload", async ({ page, db }) => {
    db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
    await login(page, "asha@acme.test");

    await page.reload();
    await expect(signOutButton(page)).toBeVisible();

    await logout(page);

    await page.reload();
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
    await expect(signOutButton(page)).toHaveCount(0);
  });

  test("switching accounts shows only the new user's data", async ({ page, db }) => {
    const a = db.addUser("a@acme.test", PASSWORD, { profile: { ...PROFILE, name: "User A" } });
    const b = db.addUser("b@acme.test", PASSWORD, { profile: { ...PROFILE, name: "User B" } });
    db.table("contacts").push({ id: "c-a", user_id: a.id, name: "Contact Of A", added_at: new Date().toISOString() });
    db.table("contacts").push({ id: "c-b", user_id: b.id, name: "Contact Of B", added_at: new Date().toISOString() });

    await login(page, "a@acme.test");
    await expect(page.getByText("Contact Of A").first()).toBeVisible();
    await logout(page);

    await login(page, "b@acme.test");
    await expect(page.getByText("Contact Of B").first()).toBeVisible();
    await expect(page.getByText("Contact Of A")).toHaveCount(0);
  });
});

test.describe("Signup (one question per screen)", () => {
  async function openSignup(page: import("@playwright/test").Page) {
    await gotoLogin(page);
    await page.getByText("Create Account", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "What's your email?" })).toBeVisible();
  }
  const cont = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Continue", exact: true }).click();

  test("each step checks its own answer; Back keeps what you typed; Enter moves on", async ({ page }) => {
    await openSignup(page);
    await expect(page.getByText("1 of 4")).toBeVisible();
    await cont(page);
    await expect(page.getByText("Please enter your email address.")).toBeVisible();
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Email").press("Enter");
    await expect(page.getByText("Please enter a valid email address.")).toBeVisible();
    await page.getByLabel("Email").fill("priya@acme.test");
    await page.getByLabel("Email").press("Enter");

    await expect(page.getByRole("heading", { name: "Create a password" })).toBeVisible();
    await expect(page.getByText("For priya@acme.test")).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill("short");
    await cont(page);
    await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill("longenough1");
    await cont(page);

    await expect(page.getByRole("heading", { name: "What's your name?" })).toBeVisible();
    await cont(page);
    await expect(page.getByText("Please enter your name.")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Create a password" })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("longenough1");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel("Email")).toHaveValue("priya@acme.test");
  });

  async function fillSignup(page: import("@playwright/test").Page, email: string, { skip = false } = {}) {
    await openSignup(page);
    await page.getByLabel("Email").fill(email);
    await cont(page);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await cont(page);
    await page.getByLabel("Full name").fill("Priya Sharma");
    await cont(page);
    await expect(page.getByRole("heading", { name: "What do you do?" })).toBeVisible();
    if (skip) return page.getByRole("button", { name: "Skip for now" }).click();
    await page.getByLabel("Your role").fill("Founder");
    await page.getByLabel("Company").fill("Sharma Ventures");
    await page.getByRole("button", { name: "Create account" }).click();
  }

  test("new user signs up in 4 short steps and lands in the app with a profile", async ({ page, db }) => {
    await fillSignup(page, "priya@acme.test");
    await expect(signOutButton(page)).toBeVisible();
    const user = db.users.find((u) => u.email === "priya@acme.test")!;
    expect(db.rowsOwnedBy("profiles", user.id)[0]).toMatchObject({ name: "Priya Sharma", company: "Sharma Ventures", role: "Founder" });
  });

  test("role and company are optional — Skip still creates the account, and no extra form appears later", async ({ page, db }) => {
    await fillSignup(page, "skip@acme.test", { skip: true });
    await expect(signOutButton(page)).toBeVisible();
    const user = db.users.find((u) => u.email === "skip@acme.test")!;
    expect(db.rowsOwnedBy("profiles", user.id)[0]).toMatchObject({ name: "Priya Sharma", company: null, role: null });
    await logout(page);
    await login(page, "skip@acme.test");
    await expect(signOutButton(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: /What do you do\?|Welcome/ })).toHaveCount(0);
  });

  test("duplicate email is rejected", async ({ page, db }) => {
    db.addUser("taken@acme.test", PASSWORD, { profile: PROFILE });
    await fillSignup(page, "taken@acme.test");
    await expect(page.getByText(/already registered/i)).toBeVisible();
  });

  test("with email confirmation, profile details survive until first login", async ({ page, db }) => {
    db.autoConfirm = false;
    await fillSignup(page, "confirm@acme.test");
    await expect(page.getByText("Verify your email")).toBeVisible();

    db.users.find((u) => u.email === "confirm@acme.test")!.confirmed = true;
    await page.getByRole("button", { name: "Back to Sign In" }).click();
    await page.getByPlaceholder("name@company.com").fill("confirm@acme.test");
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();

    // Goes straight into the app — no second "complete your profile" step
    await expect(signOutButton(page)).toBeVisible();
    const user = db.users.find((u) => u.email === "confirm@acme.test")!;
    expect(db.rowsOwnedBy("profiles", user.id)[0]).toMatchObject({ company: "Sharma Ventures" });
  });
});

test("forgot password sends a reset link", async ({ page }) => {
  await gotoLogin(page);
  await page.getByText("Forgot?").click();
  await page.locator('input[type="email"]').fill("asha@acme.test");
  await page.getByRole("button", { name: /send|reset/i }).click();
  await expect(page.getByText("Password reset link sent to your inbox.")).toBeVisible();
});
