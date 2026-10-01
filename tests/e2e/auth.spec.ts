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

    await signOutButton(page).click();
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();

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

test.describe("Signup", () => {
  async function openSignup(page: import("@playwright/test").Page) {
    await gotoLogin(page);
    await page.getByText("Create Account", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Continue →" })).toBeVisible();
  }

  test("step one validates required fields, email and password length", async ({ page }) => {
    await openSignup(page);
    await page.getByRole("button", { name: "Continue →" }).click();
    await expect(page.getByText("Please fill in your name, email and password.")).toBeVisible();

    await page.getByPlaceholder("Priya Sharma").fill("Priya");
    await page.getByPlaceholder("priya@acme.com").fill("not-an-email");
    await page.getByPlaceholder("Minimum 8 characters").fill("longenough1");
    await page.getByRole("button", { name: "Continue →" }).click();
    await expect(page.getByText("Please enter a valid email address.")).toBeVisible();

    await page.getByPlaceholder("priya@acme.com").fill("priya@acme.test");
    await page.getByPlaceholder("Minimum 8 characters").fill("short");
    await page.getByRole("button", { name: "Continue →" }).click();
    await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
  });

  async function fillSignup(page: import("@playwright/test").Page, email: string) {
    await openSignup(page);
    await page.getByPlaceholder("Priya Sharma").fill("Priya Sharma");
    await page.getByPlaceholder("priya@acme.com").fill(email);
    await page.getByPlaceholder("Minimum 8 characters").fill(PASSWORD);
    await page.getByRole("button", { name: "Continue →" }).click();
    await page.getByPlaceholder("Acme Corp").fill("Sharma Ventures");
    await page.getByPlaceholder("Founder, Lead Architect").fill("Founder");
    await page.getByRole("button", { name: "Complete Registration" }).click();
  }

  test("new user signs up and lands in the app with a profile", async ({ page, db }) => {
    await fillSignup(page, "priya@acme.test");
    await expect(signOutButton(page)).toBeVisible();
    const user = db.users.find((u) => u.email === "priya@acme.test")!;
    expect(db.rowsOwnedBy("profiles", user.id)[0]).toMatchObject({ name: "Priya Sharma", company: "Sharma Ventures" });
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
