import { test, expect, login, isMobileProject, PASSWORD, PROFILE } from "./fixtures";

const DESKTOP_SCREENS = ["All Contacts", "Roles & Taxonomy", "1-Click Follow-ups", "Card Scanner", "Proximity Radar", "Events Hub", "Digital Pass", "Add Contact"];
const MOBILE_SCREENS = ["Contacts", "Events", "Radar", "Scan", "Pass", "Add"];

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

test("AI outreach: research → 3 drafts → review → send, logged on the timeline", async ({ page, db, sentEmails }) => {
  const u = db.addUser("asha@acme.test", PASSWORD, { profile: PROFILE });
  db.table("contacts").push({ id: "c1", user_id: u.id, name: "Ravi Kumar", email: "ravi@kumar.test", company: "Kumar Freight", website: "kumarfreight.test", added_at: new Date().toISOString() });
  let authHeader = "";
  const draftBodies: any[] = [];
  await page.route("**/api/email", (route) => {
    authHeader = route.request().headers()["authorization"] || "";
    sentEmails.push(JSON.parse(route.request().postData() || "{}"));
    return route.fulfill({ json: { ok: true, provider: "resend", id: "re_123" } });
  });
  await page.route("**/api/prospect/research", (route) =>
    route.fulfill({
      json: {
        research: {
          id: "r1", contact_id: "c1", domain: "kumarfreight.test", created_at: new Date().toISOString(),
          sources: [{ id: "S1", kind: "homepage", url: "https://kumarfreight.test/", title: "Kumar Freight" }, { id: "SOC-linkedin", kind: "social", url: "https://linkedin.com/company/kf", title: "Linkedin (link only)" }, { id: "CRM", kind: "crm", url: null, title: "Card" }],
          brief: {
            company: { name: "Kumar Freight", offerings: [{ text: "Cold-chain trucking", source: "S1", evidence: "cold-chain trucking", status: "verified" }], audience: [], initiatives: [{ text: "Raised $20M", source: "S1", evidence: "x", status: "unverified" }], positioning: [], locations: [] },
            person: { role_context: [] },
            signals: [{ text: "New Pune depot", source: "S1", evidence: "opened a depot in Pune", status: "verified" }],
            potential_needs: [{ text: "May want more pharma clients", status: "inferred", based_on: ["S1"] }],
          },
          limitations: ["Social profiles (linkedin) were found on the website, but their contents need sign-in and can't be read automatically — only the links are recorded."],
        },
        contact: {},
      },
    })
  );
  const mk = (option: string, body: string) => ({ option, subjects: [`Subject ${option}`, `Other ${option}`], body: `${body}\n\nAsha`, used: [{ claim: "Pune depot", source: "S1" }, { claim: "met", source: "USER" }], checked: true, warnings: [], words: 120 });
  await page.route("**/api/prospect/draft", (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    draftBodies.push(body);
    const drafts = body.options ? [mk(body.options[0], `Shorter ${body.options[0]}`)] : [mk("A", "Hi Ravi, great meeting you."), mk("B", "Saw the new Pune depot."), mk("C", "If pharma growth is a priority…")];
    return route.fulfill({ json: { drafts, tone: body.tone, emailType: body.emailType } });
  });

  await login(page, "asha@acme.test");
  await page.getByText("Ravi Kumar", { exact: true }).first().click();
  await page.getByRole("button", { name: "Write Email" }).click();
  const dlg = page.getByRole("dialog", { name: "Write email to Ravi Kumar" });
  await dlg.getByLabel("Role").fill("COO");
  await dlg.getByRole("button", { name: "Research Kumar Freight" }).click();
  const results = dlg.getByLabel("Research results");
  await expect(results.getByText("New Pune depot")).toBeVisible();
  await expect(results.getByLabel("Not verified")).toHaveCount(1);
  await expect(results.getByText("May want more pharma clients")).toBeVisible();
  await expect(results.getByText(/need sign-in/)).toBeVisible();

  await dlg.getByRole("button", { name: "Continue" }).click();
  await expect(dlg.getByText("Tell the AI what your company does")).toBeVisible();
  await dlg.getByLabel("How you met & what they said").fill("Met at FreightTech. Wants pharma clients.");
  await dlg.getByRole("button", { name: "Lead generation" }).click();
  await dlg.getByRole("radio", { name: "Executive" }).click();
  await dlg.getByRole("button", { name: "Generate 3 drafts" }).click();
  for (const o of ["A", "B", "C"]) await expect(dlg.getByRole("region", { name: `Option ${o}` })).toBeVisible();
  expect(draftBodies[0]).toMatchObject({ contactId: "c1", researchId: "r1", manualContext: "Met at FreightTech. Wants pharma clients.", valueProps: ["Lead generation"], tone: "Executive", emailType: "Networking follow-up" });
  await expect(dlg.getByRole("region", { name: "Option B" }).getByText("Company website")).toBeVisible();

  await dlg.getByRole("button", { name: "Refine option C" }).click();
  await dlg.getByRole("button", { name: "Shorter" }).click();
  await expect(dlg.getByText("Shorter C")).toBeVisible();
  expect(draftBodies[1]).toMatchObject({ options: ["C"], refine: { kind: "shorter" } });

  const b = dlg.getByRole("region", { name: "Option B" });
  await b.getByRole("radio", { name: "Other B" }).click();
  await dlg.getByRole("button", { name: "Use option B" }).click();
  await expect(dlg.getByLabel("Subject")).toHaveValue("Other B");
  await dlg.getByLabel("Message").fill("Hi Ravi, edited by me.\n\nAsha");
  await dlg.getByRole("button", { name: "Send email" }).click();
  expect(sentEmails).toHaveLength(0); // first tap only asks for confirmation
  await dlg.getByRole("button", { name: /Tap again to send/ }).click();
  await expect(dlg.getByText("Email sent")).toBeVisible();
  expect(sentEmails[0]).toMatchObject({ to: "ravi@kumar.test", subject: "Other B", body: "Hi Ravi, edited by me.\n\nAsha" });
  expect(authHeader).toMatch(/^Bearer ey/);
  const log = db.table("follow_up_emails")[0];
  expect(log).toMatchObject({ contact_id: "c1", subject: "Other B", draft_option: "B", research_id: "r1", provider_id: "re_123", value_props: ["Lead generation"], tone: "Executive", sent: true });
  expect(db.table("contacts")[0].email_sent).toBe(true);

  await dlg.getByRole("button", { name: "Done" }).click();
  await page.getByText("Ravi Kumar", { exact: true }).first().click();
  const timeline = page.getByLabel("Email timeline");
  await expect(timeline.getByText("Other B")).toBeVisible();
  await timeline.getByRole("radio", { name: "Replied" }).click();
  await expect.poll(() => db.table("follow_up_emails")[0].reply_status).toBe("replied");
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
  await nav.getByRole("button", { name: isMobileProject() ? /^Pass$/ : /^Digital Pass/ }).last().click();
  const qr = page.getByRole("img", { name: "QR Code" });
  await expect(qr).toHaveAttribute("src", /^data:image\/png;base64,/);
  expect(external.filter((u) => u.includes("qrserver"))).toEqual([]);
});
