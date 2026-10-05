import { test, expect, type Page } from "@playwright/test";
// UX audit: every main screen at 6 phone widths — horizontal overflow, elements wider than the
// viewport, and screenshots at 360/430 for visual review. Runs against the ui-polish preview (8082).
test.setTimeout(600_000);
const WIDTHS = [360, 375, 390, 393, 412, 430];
const TABS = ["Contacts", "Events", "Radar", "Scan", "Pass", "Add"];

async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad: string[] = [];
    document.querySelectorAll("body *").forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const cs = getComputedStyle(el as HTMLElement);
      if (cs.position === "fixed" && r.right > vw + 1) bad.push(`fixed:${(el as HTMLElement).innerText?.slice(0, 30)}`);
      // only flag leaf-ish visible elements poking past the right edge (ignore horizontal scrollers' children)
      let p = (el as HTMLElement).parentElement, inScroller = false;
      while (p) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") { inScroller = p !== document.body && p !== document.documentElement; if (inScroller) break; } p = p.parentElement; }
      if (!inScroller && r.right > vw + 1 && (el as HTMLElement).children.length === 0) bad.push(`${el.tagName.toLowerCase()}:"${(el as HTMLElement).innerText?.slice(0, 30) || el.getAttribute("aria-label") || ""}" right=${Math.round(r.right)}`);
    });
    return { scroll: document.documentElement.scrollWidth - vw, bad: [...new Set(bad)].slice(0, 6) };
  });
}

test("ux audit", async ({ page }) => {
  const report: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto("http://localhost:8082/?devLogin=a");
    await expect(page.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 90_000 });
    for (const t of TABS) {
      await page.getByRole("button", { name: t, exact: true }).last().click();
      await page.waitForTimeout(900);
      const o = await overflow(page);
      if (o.scroll > 0 || o.bad.length) report.push(`${w}px ${t}: page scroll +${o.scroll}px ${o.bad.join(" | ")}`);
      if (w === 360 || w === 430) await page.screenshot({ path: `qa-logs/audit/${w}-${t}.png`, fullPage: true });
    }
    await page.getByTitle("Profile & Settings").click();
    await page.waitForTimeout(900);
    const o = await overflow(page);
    if (o.scroll > 0 || o.bad.length) report.push(`${w}px Settings: page scroll +${o.scroll}px ${o.bad.join(" | ")}`);
    if (w === 360) await page.screenshot({ path: `qa-logs/audit/${w}-Settings.png`, fullPage: true });
    if (w === 360) {
      await page.getByRole("button", { name: /^Notifications/ }).first().click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `qa-logs/audit/360-Notifications.png` });
      await page.keyboard.press("Escape");
      const search = page.getByRole("button", { name: /search/i }).first();
      if (await search.count()) { await search.click(); await page.waitForTimeout(600); await page.screenshot({ path: `qa-logs/audit/360-Search.png` }); await page.keyboard.press("Escape"); }
    }
  }
  console.log("OVERFLOW REPORT\n" + (report.join("\n") || "none"));
  console.log("PAGE ERRORS: " + JSON.stringify(errors));
});
