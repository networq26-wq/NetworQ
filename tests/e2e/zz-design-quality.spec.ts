import { test, expect, login, PASSWORD } from "./fixtures";
import type { Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

// Design quality bar (Apple HIG / WCAG): readable text, comfortable touch targets, enough contrast.
//   • no text smaller than 12px (except the calendar date badge, which mirrors Apple's Calendar icon)
//   • every button / link / field at least 44×44px (Apple's minimum touch target)
//   • text contrast at least 4.5:1 (text on photos / gradients is skipped — we can't measure the image)
type Finding = { screen: string; kind: string; detail: string };

async function measure(page: Page, screen: string): Promise<Finding[]> {
  await page.waitForTimeout(700);
  const found = await page.evaluate(() => {
    const out: { kind: string; detail: string }[] = [];
    const lum = (c: string) => {
      const m = c.match(/[\d.]+/g);
      if (!m) return 1;
      const [r, g, b] = m.slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // background behind the text; null if it sits on an image or gradient (can't be measured)
    const bgOf = (el: Element): string | null => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.backgroundImage && s.backgroundImage !== "none") return null;
        if (e.tagName === "IMG") return null;
        const a = s.backgroundColor.match(/[\d.]+/g);
        if (a && (a.length < 4 || Number(a[3]) > 0.5)) return s.backgroundColor;
      }
      return "rgb(255,255,255)";
    };
    const label = (el: Element) => ((el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40));
    const seen = new Set<string>();
    const push = (kind: string, detail: string) => { if (!seen.has(kind + detail)) { seen.add(kind + detail); out.push({ kind, detail }); } };
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
      if (el.closest("[data-date-badge]") || el.closest("svg")) continue;
      const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim().length > 1);
      if (ownText) {
        const fs = parseFloat(s.fontSize);
        if (fs < 12) push("text smaller than 12px", `${fs}px "${label(el)}"`);
        const bg = bgOf(el);
        if (bg) {
          const L1 = lum(s.color), L2 = lum(bg);
          const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          const large = fs >= 18 || (fs >= 14 && Number(s.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5) && Number(s.opacity) > 0.99) push("low contrast", `${ratio.toFixed(1)}:1 "${label(el)}"`);
        }
      }
      if (el.matches("button, a[href], [role=button], [role=tab], [role=radio], [role=switch], input:not([type=hidden]), select, textarea")) {
        if (el.closest("[data-skip-target-check]")) continue;
        if (r.width < 43.5 || r.height < 43.5) push("touch target smaller than 44px", `${Math.round(r.width)}×${Math.round(r.height)} "${label(el)}"`);
      }
    }
    return out;
  });
  return found.map((f) => ({ screen, ...f }));
}

test("design quality: readable text, 44px touch targets, contrast — every main screen", async ({ page, db }) => {
  test.skip(test.info().project.name !== "mobile-chrome", "runs once");
  test.setTimeout(180_000);
  mkdirSync("qa-logs", { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const me = db.addUser("asha@acme.test", PASSWORD, { profile: { name: "Asha Rao", company: "Acme Labs", role: "Founder", autopilot_enabled: true } });
  for (let i = 0; i < 6; i++)
    db.table("contacts").push({ id: `c${i}`, user_id: me.id, name: ["Ravi Kumar", "Lena Park", "Meera Iyer"][i % 3] + ` ${i}`, title: "Head of Partnerships", company: "Kumar AI", email: `p${i}@x.test`, reference: "Talked about AI infra", event: "TiE Hyderabad", tags: ["ai"], added_at: new Date(Date.now() - i * 864e5).toISOString(), autopilot_status: "active", autopilot_step: 0, autopilot_next_at: new Date(Date.now() + 864e5).toISOString() });
  db.addPublicEvent({ title: "Hyderabad Founders Night", starts_at: new Date(Date.now() + 2 * 864e5).toISOString(), url: "https://lu.ma/hfn", venue: "T-Hub", city: "Hyderabad", verified: true });

  const all: Finding[] = [];
  const nav = (n: string) => page.getByRole("button", { name: n, exact: true }).last().click();
  await login(page, "asha@acme.test");
  all.push(...(await measure(page, "people")));
  await page.getByText("Ravi Kumar 0", { exact: true }).first().click();
  all.push(...(await measure(page, "contact")));
  await page.getByRole("button", { name: "Close" }).last().click();
  await nav("Events");
  all.push(...(await measure(page, "events")));
  await nav("Messages");
  all.push(...(await measure(page, "messages")));
  await nav("Radar");
  all.push(...(await measure(page, "radar")));
  await nav("People");
  await page.getByRole("button", { name: "Profile & Settings" }).click();
  all.push(...(await measure(page, "me")));

  writeFileSync("qa-logs/design-quality.json", JSON.stringify(all, null, 2));
  const summary: Record<string, number> = {};
  for (const f of all) summary[`${f.screen} · ${f.kind}`] = (summary[`${f.screen} · ${f.kind}`] || 0) + 1;
  console.log("DESIGN " + JSON.stringify(summary));
  for (const f of all) console.log(`FINDING ${f.screen}: ${f.kind} — ${f.detail}`);
  expect(all, all.map((f) => `${f.screen}: ${f.kind} — ${f.detail}`).join("\n")).toEqual([]);
});
