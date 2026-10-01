import { test as base, expect, type Page } from "@playwright/test";
import { MockSupabase } from "./mock-supabase";

export const PASSWORD = "CorrectHorse9!";
export const PROFILE = { name: "Asha Rao", company: "Acme Labs", role: "Founder", sector: "Technology" };

type Fixtures = {
  db: MockSupabase;
  sentEmails: any[];
  pageErrors: string[];
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
  context: async ({ context, db, sentEmails }, use) => {
    await db.attach(context);
    await context.route("**/api/ai", (route) =>
      route.fulfill({ json: { choices: [{ message: { role: "assistant", content: "Mock AI reply" } }] } })
    );
    await context.route("**/api/email", (route) => {
      sentEmails.push(JSON.parse(route.request().postData() || "{}"));
      return route.fulfill({ json: { ok: true, provider: "mock" } });
    });
    await use(context);
  },
  page: async ({ page, pageErrors }, use) => {
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await use(page);
    expect(pageErrors, "uncaught errors in the page").toEqual([]);
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
  await signOutButton(page).click();
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
}

export function signOutButton(page: Page) {
  return page.getByRole("button", { name: "Sign out" });
}

export const isMobileProject = () => test.info().project.name.includes("mobile");

export async function openAddContact(page: Page) {
  if (isMobileProject()) {
    await page.getByRole("button", { name: "Add", exact: true }).last().click();
  } else {
    await page.getByRole("banner").getByRole("button", { name: "Add Contact" }).click();
  }
  await expect(page.getByPlaceholder("Jane Doe")).toBeVisible();
}

export async function openContact(page: Page, name: string) {
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Edit contact", exact: true })).toBeVisible();
}
