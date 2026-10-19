// Not a test: screenshots of every screen for design review (run with SHOT_DIR=dir). Skipped otherwise.
import { test, login, openPeople, PASSWORD } from "./fixtures";
const OUT = process.env.SHOT_DIR!;
for (const theme of ["light", "dark"] as const)
  test(`audit ${theme}`, async ({ page, db }) => {
    test.skip(!OUT || test.info().project.name !== "mobile-chrome", "only when SHOT_DIR is set");
    test.setTimeout(180_000);
    await page.addInitScript((t) => { try { localStorage.setItem("networq_theme", t); } catch {} }, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    const me = db.addUser("asha@acme.test", PASSWORD, { profile: { name: "Asha Rao", company: "Acme Labs", role: "Founder", autopilot_enabled: true } });
    const names = ["Ravi Kumar", "Lena Park", "Meera Iyer", "Arjun Mehta", "Priya Shah", "Tom Becker"];
    names.forEach((n, i) => db.table("contacts").push({ id: `c${i}`, user_id: me.id, name: n, title: ["Head of Partnerships", "Founder", "VP Sales", "CTO", "Investor", "Designer"][i], company: ["Kumar AI", "Parkly", "Iyer Labs", "Mehta Capital", "Shah & Co", "Becker Studio"][i], email: `p${i}@x.test`, reference: "Talked about AI infra and a pilot next quarter", event: "TiE Hyderabad", tags: ["ai", "lead"].slice(0, (i % 2) + 1), added_at: new Date(Date.now() - i * 864e5).toISOString(), reminder: "Follow up", reminder_date: i < 2 ? new Date(Date.now() - 864e5).toISOString().slice(0, 10) : null }));
    db.addPublicEvent({ title: "Hyderabad Founders Night", starts_at: new Date(Date.now() + 2 * 864e5).toISOString(), url: "https://lu.ma/hfn", venue: "T-Hub", city: "Hyderabad", verified: true, category: "Startups" });
    db.addPublicEvent({ title: "Bengaluru Product Circle", starts_at: new Date(Date.now() + 5 * 864e5).toISOString(), url: "https://lu.ma/pc", venue: "Koramangala", city: "Bengaluru", category: "Design & Product" });
    const shot = async (n: string) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${theme}-${n}.png` }); };
    const nav = (n: string) => page.getByRole("button", { name: n, exact: true }).last().click();
    await page.goto("/"); await page.waitForTimeout(800); await shot("00-login");
    await login(page, "asha@acme.test");
    await shot("01-today");
    await openPeople(page); await shot("02-people");
    await page.getByText("Ravi Kumar", { exact: true }).first().click(); await shot("03-contact");
    await page.getByRole("button", { name: "Close" }).last().click();
    await nav("Messages"); await shot("04-messages");
    await nav("Radar"); await shot("05-radar");
    await nav("Events"); await shot("06-events");
    await page.getByRole("button", { name: "Search", exact: true }).first().click(); await page.getByRole("searchbox").first().fill("Ra"); await shot("07-search");
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    await page.getByRole("button", { name: "AI Assistant" }).click(); await shot("08-ai");
    await page.keyboard.press("Escape"); await page.getByRole("button", { name: /^Close/ }).last().click().catch(() => {});
    await page.getByRole("button", { name: "Profile & Settings" }).click(); await shot("09-me");
    await nav("Today"); await page.getByRole("region", { name: "Quick actions" }).getByRole("button", { name: "Type it in" }).click(); await shot("10-add");
  });
