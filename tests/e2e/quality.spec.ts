import { test, expect, login, isMobileProject, PASSWORD, PROFILE } from "./fixtures";

const DESKTOP_SCREENS = ["All Contacts", "Roles & Taxonomy", "1-Click Follow-ups", "Card Scanner", "Proximity Radar", "Events Hub", "Digital Pass", "Add Contact"];
const MOBILE_SCREENS = ["Contacts", "Events", "Radar", "Scan", "3D Pass", "Add"];

async function noHorizontalScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls horizontally").toBeLessThanOrEqual(1);
}

test("every main screen renders without crashing or overflowing", async ({ page, db }) => {
  const u = db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
  db.table("contacts").push(
    { id: "c1", user_id: u.id, name: "Ravi Kumar", title: "CEO", company: "Kumar AI", email: "ravi@kumar.test", tags: ["ai"], added_at: new Date().toISOString() },
    { id: "c2", user_id: u.id, name: "Lena Park", title: "Partner", company: "Seed Fund", added_at: new Date().toISOString() }
  );
  await login(page, "asha@acme.test");

  const nav = isMobileProject() ? page.locator("body") : page.getByRole("complementary");
  for (const label of isMobileProject() ? MOBILE_SCREENS : DESKTOP_SCREENS) {
    await test.step(label, async () => {
      await nav.getByRole("button", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).last().click();
      await page.waitForTimeout(400);
      // Some screens open a modal (e.g. 1-Click Follow-ups) — close it like a user would
      const close = page.getByRole("button", { name: "Close", exact: true });
      if (await close.count()) await close.last().click();
      await expect(page.getByRole("button", { name: "Profile & Settings" })).toBeVisible();
      await noHorizontalScroll(page);
    });
  }
});

for (const width of [375, 390, 768, 1280, 1440]) {
  test(`login and home fit a ${width}px screen`, async ({ page, db }) => {
    test.skip(isMobileProject(), "viewport sweep runs on the desktop project");
    db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible({ timeout: 8_000 });
    await noHorizontalScroll(page);
    await login(page, "asha@acme.test");
    await noHorizontalScroll(page);
  });
}

test("follow-up email is sent through the authenticated backend", async ({ page, db, sentEmails }) => {
  const u = db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
  db.table("contacts").push({ id: "c1", user_id: u.id, name: "Ravi Kumar", email: "ravi@kumar.test", added_at: new Date().toISOString() });
  let authHeader = "";
  await page.route("**/api/email", (route) => {
    authHeader = route.request().headers()["authorization"] || "";
    sentEmails.push(JSON.parse(route.request().postData() || "{}"));
    return route.fulfill({ json: { ok: true, provider: "mock" } });
  });
  await login(page, "asha@acme.test");
  await page.getByText("Ravi Kumar", { exact: true }).first().click();
  await page.getByRole("button", { name: "Intro Email" }).click();
  const send = page.getByRole("button", { name: "Send Email" });
  await expect(send).toBeVisible();
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  await expect(page.getByText("Email sent to ravi@kumar.test")).toBeVisible();
  expect(sentEmails[0]).toMatchObject({ to: "ravi@kumar.test" });
  expect(authHeader).toMatch(/^Bearer ey/);
  expect(db.table("contacts")[0].email_sent).toBe(true);
});

test("API health endpoint is live", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).status).toBe("ok");
});

test("Digital Pass QR is generated on-device (no profile data sent to third parties)", async ({ page, db }) => {
  db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
  const external: string[] = [];
  page.on("request", (r) => {
    const host = new URL(r.url()).hostname;
    if (!["localhost", "127.0.0.1"].includes(host) && !host.endsWith(".supabase.co")) external.push(r.url());
  });
  await login(page, "asha@acme.test");
  const nav = isMobileProject() ? page.locator("body") : page.getByRole("complementary");
  await nav.getByRole("button", { name: isMobileProject() ? /^3D Pass/ : /^Digital Pass/ }).last().click();
  const qr = page.getByRole("img", { name: "QR Code" });
  await expect(qr).toHaveAttribute("src", /^data:image\/png;base64,/);
  expect(external.filter((u) => u.includes("qrserver"))).toEqual([]);
});
