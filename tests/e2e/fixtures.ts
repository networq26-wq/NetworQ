import { test as base, expect, type Page } from "@playwright/test";
import { MockSupabase } from "./mock-supabase";

export const PASSWORD = "CorrectHorse9!";
export const PROFILE = { name: "Asha Rao", company: "Acme Labs", role: "Founder", sector: "Technology" };

type Fixtures = {
  db: MockSupabase;
  sentEmails: any[];
  pageErrors: string[];
  accountCalls: { path: string; body: any }[];
};

export const test = base.extend<Fixtures>({
  db: async ({}, use) => {
    await use(new MockSupabase());
  },
  sentEmails: async ({}, use) => {
    await use([]);
  },
  pageErrors: async ({}, use) => {
    await use([]);
  },
  accountCalls: async ({}, use) => {
    await use([]);
  },
  context: async ({ context, db, sentEmails, accountCalls }, use) => {
    await db.attach(context);
    await context.route("**/api/ai", (route) =>
      route.fulfill({ json: { choices: [{ message: { role: "assistant", content: "Mock AI reply" } }] } })
    );
    await context.route("**/api/email", (route) => {
      sentEmails.push(JSON.parse(route.request().postData() || "{}"));
      return route.fulfill({ json: { ok: true, provider: "mock" } });
    });
    // Realtime websockets are not mocked: close them so tests never reach a real project (polling fallback is used)
    await context.routeWebSocket(/supabase\.co/, (ws) => ws.close());
        // Events import (api/events.js extraction is tested separately with real-page fixtures)
    await context.route("**/api/events/import", async (route) => {
      const req = route.request();
      if (!db.userFromRequest(req)) return route.fulfill({ status: 401, json: { error: "Please sign in again." } });
      const { url } = JSON.parse(req.postData() || "{}");
      if (!/^https:\/\/lu\.ma\//.test(url)) return route.fulfill({ status: 422, json: { error: "We couldn't find event details on that page." } });
      const row = db.addPublicEvent({ title: "AI Builders Night Hyderabad", starts_at: new Date(Date.now() + 5 * 86400000).toISOString(), url, venue: "T-Hub, Raidurg", city: "Hyderabad", organizer: "Hyderabad AI Collective" });
      return route.fulfill({ json: { ok: true, events: [row] } });
    });
    // Account endpoints (api/account.js is tested separately with fakes)
    await context.route(/\/api\/(auth|account)\//, async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const body = req.postData() ? JSON.parse(req.postData() as string) : {};
      accountCalls.push({ path, body });
      const user = db.userFromRequest(req);
      if (!user) return route.fulfill({ status: 401, json: { error: "Please sign in again." } });
      const prof = db.table("profiles").find((r) => r.id === user.id);
      if (path.endsWith("/account/delete")) {
        const at = new Date(Date.now() + 7 * 86400000).toISOString();
        if (prof) prof.deletion_scheduled_at = at;
        return route.fulfill({ json: { ok: true, scheduled_for: at } });
      }
      if (path.endsWith("/account/cancel-deletion")) {
        if (prof) prof.deletion_scheduled_at = null;
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: { ok: true, first_login: false, new_device: false } });
    });
    await use(context);
  },
  page: async ({ page, pageErrors }, use) => {
    page.on("pageerror", (err) => pageErrors.push(err.message));
    // Fail on anything the production Content-Security-Policy blocks
    await page.addInitScript(() => {
      (window as any).__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => {
        (window as any).__cspViolations.push(`${e.violatedDirective} ← ${e.blockedURI}`);
      });
    });
    await use(page);
    expect(pageErrors, "uncaught errors in the page").toEqual([]);
    const csp = await page.evaluate(() => (window as any).__cspViolations || []).catch(() => []);
    expect(csp, "Content-Security-Policy violations").toEqual([]);
  },
});

export { expect };

export async function gotoLogin(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible({ timeout: 8_000 });
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await gotoLogin(page);
  await page.getByPlaceholder("name@company.com").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(signOutButton(page)).toBeVisible();
}

export async function logout(page: Page) {
  // Phones: Me (header avatar) → Account → Sign out; desktop: header button
  if (isMobileProject()) {
    await page.getByRole("button", { name: "Profile & Settings" }).click();
    await page.getByRole("button", { name: /^Account/ }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
  } else {
    await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
  }
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
}

/** Visible whenever a user is signed in (header avatar on desktop and phones). */
export function signOutButton(page: Page) {
  return page.getByRole("button", { name: "Profile & Settings" });
}

export const isMobileProject = () => test.info().project.name.includes("mobile");

export async function openAddContact(page: Page) {
  if (isMobileProject()) {
    // No "Add" tab any more: the People home quick action "Type it in" opens the form
    await page.getByRole("button", { name: "Type it in", exact: true }).click();
  } else {
    await page.getByRole("banner").getByRole("button", { name: "Add Contact" }).click();
  }
  await expect(page.getByPlaceholder("Jane Doe")).toBeVisible();
}

export async function openContact(page: Page, name: string) {
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Edit contact", exact: true })).toBeVisible();
}
