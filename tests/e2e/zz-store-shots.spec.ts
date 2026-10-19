// Not a test: captures Play Store screenshots (run with STORE_SHOTS=dir). Skipped otherwise.
import { test, login, openPeople, PASSWORD } from "./fixtures";
const OUT = process.env.STORE_SHOTS;
test("store screenshots", async ({ browser, db }) => {
  test.skip(!OUT || test.info().project.name !== "mobile-chrome", "only when STORE_SHOTS is set");
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await db.attach(ctx);
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem("networq_theme", "light"); } catch {} });
  const me = db.addUser("priya@acme.test", PASSWORD, { profile: { name: "Priya Sharma", company: "Lumen AI", role: "Founder", autopilot_enabled: true, autopilot_days: [1, 7, 30] } });
  const people = [
    ["Ravi Kumar", "Head of Partnerships", "Kumar Freight", "Talked about a pilot for their Pune depot"],
    ["Ananya Rao", "VP Product", "Finova", "Wants intro to our design lead"],
    ["Arjun Mehta", "Partner", "Mehta Capital", "Interested in seed round, send deck"],
    ["Lena Park", "Head of Growth", "Parkly", "Swap notes on India launch"],
    ["Karan Shah", "CTO", "Shah & Co", "Evaluating AI vendors this quarter"],
    ["Meera Iyer", "Founder", "Iyer Labs", "Met at TiE Hyderabad, coffee next week"],
  ];
  const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
  people.forEach(([name, title, company, ref], i) =>
    db.table("contacts").push({ id: `c${i}`, user_id: me.id, name, title, company, email: `${name.split(" ")[0].toLowerCase()}@${company.split(" ")[0].toLowerCase()}.com`, reference: ref, event: "TiE Hyderabad", tags: [["lead"], ["intro"], ["investor"], [], ["lead"], []][i], added_at: d(-i - 1), reminder: "Follow up", reminder_date: i < 2 ? d(-1).slice(0, 10) : i === 2 ? d(0).slice(0, 10) : null, autopilot_status: "active", autopilot_step: 0, autopilot_next_at: d(i + 1) })
  );
  db.addPublicEvent({ title: "Hyderabad Founders Night", starts_at: d(2), url: "https://lu.ma/hfn", venue: "T-Hub", city: "Hyderabad", verified: true, category: "Startups" });
  db.addPublicEvent({ title: "Bengaluru Product Circle", starts_at: d(5), url: "https://lu.ma/pc", venue: "Koramangala", city: "Bengaluru", category: "Design & Product" });
  db.addPublicEvent({ title: "Mumbai AI Builders Meetup", starts_at: d(8), url: "https://lu.ma/ai", venue: "WeWork BKC", city: "Mumbai", category: "AI & Data" });
  const shot = async (n: string) => { await page.waitForTimeout(4200); await page.screenshot({ path: `${OUT}/${n}.png` }); }; // wait for the Ask AI pill to shrink
  const nav = (n: string) => page.getByRole("button", { name: n, exact: true }).last().click();
  await login(page, "priya@acme.test");
  await shot("1-today");
  await openPeople(page); await shot("2-people");
  await page.getByText("Arjun Mehta", { exact: true }).first().click(); await shot("3-contact");
  await page.getByRole("button", { name: "Close" }).last().click();
  await nav("Events"); await shot("4-events");
  await page.getByRole("button", { name: "Profile & Settings" }).click();
  await page.getByRole("button", { name: /Follow-up autopilot/ }).first().click(); await shot("5-autopilot");
  await nav("Today");
  await page.getByRole("button", { name: "AI Assistant" }).click(); await shot("6-ai");
  await ctx.close();
});
