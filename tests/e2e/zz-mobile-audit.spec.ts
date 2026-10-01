import { test, expect, login, PASSWORD } from "./fixtures";
import type { Page } from "@playwright/test";

for (const vp of [{ name: "pixel7", width: 412, height: 915 }, { name: "small", width: 360, height: 740 }]) {
  test(`mobile audit ${vp.name}`, async ({ page, db }) => {
    test.skip(test.info().project.name !== "mobile-chrome", "runs once");
    test.setTimeout(180_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.addInitScript(() => {
      (window as any).__NETWORQ_SHELL__ = { googleAuth: true };
      (window as any).ReactNativeWebView = { postMessage(raw: string) { const m = JSON.parse(raw);
        const r = (d: any) => setTimeout(() => window.dispatchEvent(new CustomEvent("networq-native", { detail: d })), 10);
        if (m.type === "radar:capabilities") r({ type: "radar:capabilities", state: "on", permission: "granted" });
        if (m.type === "radar:start") r({ type: "radar:state", state: "on" }); } };
    });
    const me = db.addUser("asha@acme.test", PASSWORD, { profile: { name: "Asha Rao", company: "Acme Labs", role: "Founder", notification_prefs: { login_alerts: true, reminder_emails: true, product_updates: false } } });
    const now = Date.now();
    ["Ravi Kumar|CEO|Kumar AI|ravi@kumar.test", "Lena Park|Partner|Seed Fund|lena@seed.test", "Meera Iyer|VP Sales|Freshworks|", "Arjun Das|CTO|Zerodha|arjun@z.test"].forEach((r, i) => {
      const [name, title, company, email] = r.split("|");
      db.table("contacts").push({ id: `c${i}`, user_id: me.id, name, title, company, email: email || null, tags: ["ai"], added_at: new Date(now - i * 86400000).toISOString() });
    });
    db.addPublicEvent({ title: "Hyderabad Founders Night — Startup Networking", starts_at: new Date(now + 2 * 86400000).toISOString(), url: "https://lu.ma/hfn", venue: "T-Hub, Raidurg", city: "Hyderabad", organizer: "Founders Collective", verified: true });
    db.addPublicEvent({ title: "AI Builders Meetup", starts_at: new Date(now + 4 * 86400000).toISOString(), url: "https://lu.ma/aib", venue: "BHIVE, Koramangala", city: "Bengaluru" });

    const shot = async (name: string) => {
      await page.waitForTimeout(700);
      await page.screenshot({ path: `qa-logs/mobile/${vp.name}-${name}.png` });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) console.log(`OVERFLOW ${vp.name}/${name}: ${overflow}px`);
    };
    const nav = (label: string) => page.getByRole("button", { name: label, exact: true }).last().click();

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible({ timeout: 8000 });
    await shot("01-login");
    await login(page, "asha@acme.test");
    await shot("02-contacts");
    await page.getByText("Ravi Kumar", { exact: true }).first().click();
    await shot("03-contact-modal");
    await page.getByRole("button", { name: "Close" }).last().click();
    await nav("Events"); await shot("04-events");
    await nav("Radar"); await shot("05-radar");
    await nav("Scan"); await shot("06-scan");
    await nav("3D Pass"); await shot("07-pass");
    await nav("Add"); await shot("08-add");
    await page.getByRole("button", { name: "Profile & Settings" }).click().catch(() => console.log(`NO SETTINGS ENTRY ${vp.name}`));
    await shot("09-settings");
    await nav("Contacts");
    const ai = page.getByRole("button", { name: "AI Assistant" });
    if (await ai.count()) { await ai.first().click(); await shot("10-ai-open"); }
  });
}
