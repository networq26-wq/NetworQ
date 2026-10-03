import { test, expect, login, isMobileProject, PASSWORD, PROFILE } from "./fixtures";

async function openEvents(page: import("@playwright/test").Page) {
  if (isMobileProject()) await page.getByRole("button", { name: "Events", exact: true }).last().click();
  else await page.getByRole("complementary").getByRole("button", { name: /^Events Hub/ }).click();
  await expect(page.getByRole("heading", { name: "Events", exact: true })).toBeVisible();
}

test.describe("Events Hub (real events only)", () => {
  test.beforeEach(async ({ db }) => {
    db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
  });

  test("no fabricated events: empty state invites importing a real link", async ({ page }) => {
    await login(page, "asha@acme.test");
    await openEvents(page);
    await expect(page.getByText("No upcoming events yet")).toBeVisible();
    await expect(page.getByRole("list", { name: "Upcoming events" })).toHaveCount(0);
  });

  test("importing an event link adds a card with its source and official link", async ({ page, db }) => {
    await login(page, "asha@acme.test");
    await openEvents(page);
    await page.getByLabel("Event or calendar link").fill("https://lu.ma/ai-builders-hyd");
    await page.getByRole("button", { name: "Add event" }).click();
    await expect(page.getByText("Added 1 event.")).toBeVisible();
    const list = page.getByRole("list", { name: "Upcoming events" });
    await expect(list.getByRole("heading", { name: "AI Builders Night Hyderabad" })).toBeVisible();
    await expect(list.getByText("Source: lu.ma")).toBeVisible();
    await expect(list.getByRole("link", { name: "Event page ↗" })).toHaveAttribute("href", "https://lu.ma/ai-builders-hyd");
    expect(db.table("public_events")).toHaveLength(1);
  });

  test("links without event data are rejected with guidance", async ({ page }) => {
    await login(page, "asha@acme.test");
    await openEvents(page);
    await page.getByLabel("Event or calendar link").fill("https://blog.example.com/post");
    await page.getByRole("button", { name: "Add event" }).click();
    await expect(page.getByText("We couldn't find event details on that page.")).toBeVisible();
  });

  test("past events are hidden; search, city, date and category filters narrow the list", async ({ page, db }) => {
    const day = 86400000;
    db.addPublicEvent({ title: "Yesterday's Meetup", starts_at: new Date(Date.now() - 2 * day).toISOString(), url: "https://lu.ma/old", city: "Hyderabad" });
    db.addPublicEvent({ title: "Hyderabad Fintech Forum", starts_at: new Date(Date.now() + 2 * day).toISOString(), url: "https://lu.ma/fin", city: "Hyderabad", verified: true, category: "Finance & Web3" });
    db.addPublicEvent({ title: "Bengaluru Product Circle", starts_at: new Date(Date.now() + 3 * day).toISOString(), url: "https://lu.ma/pc", city: "Bengaluru", category: "Design & Product" });
    db.addPublicEvent({ title: "London AI Summit", starts_at: new Date(Date.now() + 40 * day).toISOString(), url: "https://lu.ma/lon", city: "London", category: "AI & Data" });
    await login(page, "asha@acme.test");
    await openEvents(page);
    const list = page.getByRole("list", { name: "Upcoming events" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(page.getByText("Yesterday's Meetup")).toHaveCount(0);
    await expect(list.getByText("Verified")).toHaveCount(1);
    await expect(list.getByText("Finance & Web3")).toBeVisible();

    await page.getByLabel("City").selectOption("Bengaluru");
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await page.getByLabel("City").selectOption("All India");
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await page.getByLabel("City").selectOption("Worldwide");
    await expect(list.getByText("London AI Summit")).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await page.getByLabel("City").selectOption("All");

    await page.getByRole("group", { name: "Filter by date" }).getByRole("button", { name: "This month" }).click();
    await expect(page.getByText("London AI Summit")).toHaveCount(0);
    await page.getByRole("group", { name: "Filter by date" }).getByRole("button", { name: "Any time" }).click();

    const cats = page.getByRole("group", { name: "Filter by category" });
    await expect(cats.getByRole("button", { name: "All · 3" })).toBeVisible();
    await cats.getByRole("button", { name: "AI & Data · 1" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Search events").fill("fintech");
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list.getByText("Hyderabad Fintech Forum")).toBeVisible();
  });

  test("Add to calendar downloads a valid .ics file", async ({ page, db }) => {
    db.addPublicEvent({ title: "Hyderabad Fintech Forum", starts_at: new Date(Date.now() + 2 * 86400000).toISOString(), url: "https://lu.ma/fin", venue: "T-Hub" });
    await login(page, "asha@acme.test");
    await openEvents(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Add Hyderabad Fintech Forum to calendar" }).click()]);
    const body = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain("SUMMARY:Hyderabad Fintech Forum");
    expect(body).toContain("URL:https://lu.ma/fin");
  });
});
