import { test, expect, login, PASSWORD } from "./fixtures";
import type { Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

// Layout audit: on every main screen, at phone / tablet / desktop widths, check for
//   • sideways page scrolling
//   • visible things cut off at the screen edge (outside any sideways-scrolling strip)
//   • buttons whose label doesn't fit
//   • the last content hidden behind the bottom navigation bar after scrolling to the end
//   • open dialogs taller than the screen that can't be scrolled
type Issue = { screen: string; width: number; kind: string; detail: string };

async function audit(page: Page, screen: string, width: number): Promise<Issue[]> {
  await page.waitForTimeout(600);
  const found = await page.evaluate(() => {
    const out: { kind: string; detail: string }[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const label = (el: Element) => {
      const t = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.tagName).trim().replace(/\s+/g, " ");
      return `${el.tagName.toLowerCase()} "${t.slice(0, 50)}"`;
    };
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    // Excused: inside a sideways-scrolling strip, or deliberately clipped by a component (e.g. a carousel).
    // Clipping by the page itself (html / body / app root) is NOT excused — that content is just cut off.
    const pageLevel = new Set([document.documentElement, document.body, document.getElementById("root"), document.body.firstElementChild]);
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowX)) return true;
        if (/(hidden|clip)/.test(s.overflowX) && !pageLevel.has(p)) return true;
      }
      return false;
    };
    const overflow = document.documentElement.scrollWidth - vw;
    if (overflow > 1) out.push({ kind: "page scrolls sideways", detail: `${overflow}px wider than the screen` });

    const seen = new Set<string>();
    for (const el of Array.from(document.body.querySelectorAll("button, a, input, select, textarea, img, svg, h1, h2, h3, p, span, label, [role=button]"))) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue; // off screen vertically: ignore
      if ((r.right > vw + 1 || r.left < -1) && !inScroller(el)) {
        const d = `${label(el)} spans ${Math.round(r.left)}→${Math.round(r.right)} (screen ${vw})`;
        if (!seen.has(d)) out.push({ kind: "cut off at screen edge", detail: d }), seen.add(d);
      }
    }
    for (const el of Array.from(document.body.querySelectorAll("button, [role=button], a.btn"))) {
      if (!visible(el)) continue;
      const h = el as HTMLElement;
      const s = getComputedStyle(h);
      const clipped = h.scrollWidth > h.clientWidth + 2 && s.overflowX !== "visible" && s.textOverflow !== "ellipsis";
      if (clipped && h.innerText.trim()) out.push({ kind: "button text doesn't fit", detail: `${label(el)} needs ${h.scrollWidth}px, has ${h.clientWidth}px` });
    }
    // Open dialogs must fit or scroll
    for (const d of Array.from(document.querySelectorAll('[role=dialog], [aria-modal="true"]'))) {
      if (!visible(d)) continue;
      const r = d.getBoundingClientRect();
      if (r.height > vh + 2) {
        let scrolls = false;
        for (const el of [d, ...Array.from(d.querySelectorAll("*"))]) {
          const s = getComputedStyle(el);
          if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) scrolls = true;
        }
        if (!scrolls) out.push({ kind: "dialog taller than screen and can't scroll", detail: `${label(d)} ${Math.round(r.height)}px vs ${vh}px` });
      }
    }
    return out;
  });

  // Bottom bar: scroll everything to the end, then the last content must sit above the bar
  const covered = await page.evaluate(async () => {
    const nav = Array.from(document.querySelectorAll("nav")).find((n) => {
      const s = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      return s.position === "fixed" && r.bottom >= window.innerHeight - 40 && r.width > 200;
    });
    if (!nav) return null;
    const scrollers = [document.scrollingElement as Element, ...Array.from(document.querySelectorAll("*")).filter((el) => {
      const s = getComputedStyle(el);
      return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 4 && !nav.contains(el);
    })];
    for (const s of scrollers) s.scrollTop = s.scrollHeight;
    await new Promise((r) => setTimeout(r, 400));
    const navTop = nav.getBoundingClientRect().top;
    let worst: { text: string; bottom: number } | null = null;
    for (const el of Array.from(document.querySelectorAll("button, a, p, h2, h3, input, li, [role=button]"))) {
      if (nav.contains(el) || el.closest("[role=dialog]")) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || s.position === "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.height < 2 || r.width < 2 || r.top > window.innerHeight || r.bottom < navTop) continue;
      if (r.top < navTop && r.bottom > navTop + 4 || (r.top >= navTop && r.top < window.innerHeight)) {
        if (!worst || r.bottom > worst.bottom) worst = { text: ((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 50), bottom: Math.round(r.bottom) };
      }
    }
    for (const s of scrollers) s.scrollTop = 0;
    return worst ? `"${worst.text}" ends at ${worst.bottom}px, bar starts at ${Math.round(navTop)}px` : null;
  });
  if (covered) found.push({ kind: "hidden behind bottom bar at the end of the page", detail: covered });

  await page.screenshot({ path: `qa-logs/layout/${width}-${screen}.png` });
  return found.map((f) => ({ screen, width, ...f }));
}

const WIDTHS = [360, 390, 768, 1366];

for (const width of WIDTHS) {
  test(`layout audit — app at ${width}px`, async ({ page, db }) => {
    test.skip(test.info().project.name !== "mobile-chrome", "runs once per width");
    test.setTimeout(240_000);
    mkdirSync("qa-logs/layout", { recursive: true });
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    await page.addInitScript(() => {
      (window as any).__NETWORQ_SHELL__ = { googleAuth: true, appLock: true };
      (window as any).ReactNativeWebView = { postMessage(raw: string) { const m = JSON.parse(raw);
        const r = (d: any) => setTimeout(() => window.dispatchEvent(new CustomEvent("networq-native", { detail: d })), 10);
        if (m.type === "radar:capabilities") r({ type: "radar:capabilities", state: "on", permission: "granted" });
        if (m.type === "radar:start") r({ type: "radar:state", state: "on" });
        if (m.type === "lock:get") r({ type: "lock:state", supported: true, biometric: true, fingerprint: true, enabled: false, timeoutMs: 60000 }); } };
    });
    const me = db.addUser("asha@acme.test", PASSWORD, { profile: { name: "Asha Rao", company: "Acme Labs", role: "Founder", notification_prefs: { login_alerts: true, reminder_emails: true, product_updates: false } } });
    const now = Date.now();
    for (let i = 0; i < 14; i++) {
      db.table("contacts").push({ id: `c${i}`, user_id: me.id, name: ["Ravi Kumar", "Lena Park", "Meera Iyer", "Arjun Das", "Sanya Kapoor With A Very Long Name"][i % 5] + (i > 4 ? ` ${i}` : ""), title: "Head of Partnerships & Strategic Alliances", company: ["Kumar AI", "Seed Fund", "Freshworks", "Zerodha", "Razorpay Software Pvt Ltd"][i % 5], email: `p${i}@x.test`, tags: ["ai", "founder"], added_at: new Date(now - i * 86400000).toISOString() });
    }
    db.addPublicEvent({ title: "Hyderabad Founders Night — Startup Networking With A Long Title", starts_at: new Date(now + 2 * 86400000).toISOString(), url: "https://lu.ma/hfn", venue: "T-Hub, Raidurg", city: "Hyderabad", organizer: "Founders Collective", verified: true });
    db.addPublicEvent({ title: "AI Builders Meetup", starts_at: new Date(now + 4 * 86400000).toISOString(), url: "https://lu.ma/aib", venue: "BHIVE, Koramangala", city: "Bengaluru" });

    const issues: Issue[] = [];
    const nav = (name: string) => page.getByRole("button", { name, exact: true }).last().click();
    const step = async (screen: string, go?: () => Promise<unknown>) => {
      try {
        if (go) await go();
        issues.push(...(await audit(page, screen, width)));
      } catch (e: any) {
        issues.push({ screen, width, kind: "couldn't open screen", detail: String(e.message).split("\n")[0].slice(0, 120) });
      }
    };

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible({ timeout: 8000 });
    if (process.env.NQ_AUDIT_SELFTEST) {
      // Proves the checks work: a too-wide banner, a cramped button and a tall dialog must all be reported
      await page.evaluate(() => {
        const wide = Object.assign(document.createElement("p"), { textContent: "too wide" });
        wide.style.cssText = "width:2000px;margin:0";
        const btn = Object.assign(document.createElement("button"), { textContent: "A very long button label that cannot fit" });
        btn.style.cssText = "width:60px;overflow:hidden;white-space:nowrap";
        const dlg = document.createElement("div");
        dlg.setAttribute("role", "dialog");
        dlg.style.cssText = "position:fixed;top:0;left:0;width:200px;height:3000px;background:#eee;overflow:hidden";
        dlg.textContent = "tall";
        document.body.append(wide, btn, dlg);
      });
    }
    await step("sign-in");
    await login(page, "asha@acme.test");
    await step("people");
    await step("contact", () => page.getByText("Ravi Kumar", { exact: true }).first().click());
    await page.getByRole("button", { name: "Close" }).last().click().catch(() => {});
    await step("messages", () => nav("Messages"));
    await step("radar", () => nav("Radar"));
    await step("events", () => nav("Events"));
    await step("add-contact", async () => { await nav("People"); await nav("Type it in"); });
    await step("my-qr", async () => { await nav("People"); await nav("My QR"); });
    await step("settings", async () => { await nav("People"); await page.getByRole("button", { name: "Profile & Settings" }).click(); });

    // Every tab's content must start and end at the same edges (no jumping when switching tabs)
    const edges: Record<string, { left: number; right: number }> = {};
    for (const [screen, go] of [
      ["people", () => nav("People")], ["messages", () => nav("Messages")], ["radar", () => nav("Radar")], ["events", () => nav("Events")],
      ["me", async () => { await nav("People"); await page.getByRole("button", { name: "Profile & Settings" }).click(); }],
    ] as [string, () => Promise<unknown>][]) {
      await go();
      await page.waitForTimeout(500);
      edges[screen] = await page.evaluate(() => {
        const box = document.querySelector(".nq-screen") as HTMLElement;
        const cs = getComputedStyle(box);
        const r = box.getBoundingClientRect();
        const contentLeft = r.left + parseFloat(cs.paddingLeft);
        const contentRight = r.right - parseFloat(cs.paddingRight);
        let left = Infinity, right = -Infinity;
        for (const el of Array.from(box.querySelectorAll("h1, h2, section, header, [role=tablist], input, ul, li, article, button"))) {
          const s = getComputedStyle(el);
          if (s.position === "fixed" || s.display === "none" || el.closest("[role=dialog]")) continue;
          let inStrip = false; // sideways-scrolling chip strips may extend past the edge by design
          for (let p = el.parentElement; p && p !== box; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) inStrip = true;
          if (inStrip) continue;
          const b = el.getBoundingClientRect();
          if (b.width < 2 || b.height < 2) continue;
          left = Math.min(left, b.left);
          right = Math.max(right, b.right);
        }
        return { left: Math.round(left - contentLeft), right: Math.round(contentRight - right) };
      });
    }
    writeFileSync(`qa-logs/layout/edges-${width}.json`, JSON.stringify(edges, null, 2));
    for (const [screen, e] of Object.entries(edges)) {
      if (e.left > 2 || e.left < -2) issues.push({ screen, width, kind: "content doesn't start at the shared left edge", detail: `${e.left}px off` });
      if (e.right < -2) issues.push({ screen, width, kind: "content spills past the shared right edge", detail: `${-e.right}px` });
    }
    console.log(`EDGES ${width}px ${JSON.stringify(edges)}`);

    writeFileSync(`qa-logs/layout/app-${width}.json`, JSON.stringify(issues, null, 2));
    for (const i of issues) console.log(`ISSUE ${i.width}px ${i.screen}: ${i.kind} — ${i.detail}`);
    expect(issues, issues.map((i) => `${i.screen}: ${i.kind} — ${i.detail}`).join("\n")).toEqual([]);
  });
}
