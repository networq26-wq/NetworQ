import { test, expect, type Page, type BrowserContext } from "@playwright/test";
const APP = "http://localhost:8081";
const issues: string[] = [];

async function open(ctx: BrowserContext, who: string, rssi: number) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 393, height: 764 });
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) issues.push(`[${who}] console.${m.type()}: ${m.text().replace(/\s+/g, " ").slice(0, 220)}`);
  });
  page.on("pageerror", (e) => issues.push(`[${who}] pageerror: ${e.message.slice(0, 220)}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/hot") && !r.url().includes("favicon")) issues.push(`[${who}] HTTP ${r.status()} ${r.request().method()} ${r.url().replace(/\?.*/, "").slice(0, 120)}`);
  });
  await page.goto(`${APP}/?shell=android&bleRssi=${rssi}`);
  await page.getByPlaceholder("name@company.com").fill(`preview.${who}@networq.co.in`);
  await page.getByLabel("Password", { exact: true }).fill("Preview#2026");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page.getByRole("button", { name: "Profile & Settings" })).toBeVisible({ timeout: 30_000 });
  return page;
}

async function leaveAll(p: Page) {
  // wait until Radar has loaded either an event or the join screen
  await expect(p.getByRole("button", { name: "Leave event", exact: true }).or(p.getByRole("button", { name: "Create event" }))).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 6; i++) {
    const leave = p.getByRole("button", { name: "Leave event", exact: true });
    if (!(await leave.count())) return;
    await leave.click();
    await p.getByRole("button", { name: "Confirm leave event", exact: true }).click();
    await p.waitForTimeout(1500);
  }
}
const nav = (p: Page, l: string) => p.getByRole("button", { name: l, exact: true }).last().click();

test("two-user bug hunt in the preview", async ({ browser }) => {
  test.setTimeout(300_000);
  try {
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await open(ctxA, "a", -79), b = await open(ctxB, "b", -71);

  for (const tab of ["Events", "Scan", "3D Pass", "Add", "Contacts"]) { await nav(a, tab); await a.waitForTimeout(1200); }
  await a.getByRole("button", { name: "Profile & Settings" }).click(); await a.waitForTimeout(1200);
  await a.getByRole("button", { name: "AI Assistant" }).click(); await a.waitForTimeout(800);
  await a.getByRole("button", { name: "Close" }).last().click().catch(() => issues.push("AI sheet: no Close button"));

  // Radar: create event as A, join as B
  await nav(a, "Radar");
  await leaveAll(a);
  await a.getByRole("button", { name: "Create event" }).click();
  await a.getByLabel("Event name").fill(`Preview QA ${Date.now() % 10000}`);
  await a.getByRole("button", { name: "Create & get code" }).click();
  const dialog = a.getByRole("dialog", { name: "Share event" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  const code = (await dialog.getByText(/^NQ-[A-Z0-9]{6}$/).textContent())!.trim();
  await dialog.getByRole("button", { name: "Close" }).click();
  console.log("event code:", code);

  await nav(b, "Radar");
  await leaveAll(b);
  await b.getByLabel("Event code", { exact: true }).fill(code);
  await b.getByRole("button", { name: "Join event" }).click();

  const nearbyA = a.getByRole("list", { name: "Nearby attendees" });
  const nearbyB = b.getByRole("list", { name: "Nearby attendees" });
  await expect(nearbyA.getByText("Preview Bob")).toBeVisible({ timeout: 40_000 });
  await expect(a.getByText("2 joined")).toBeVisible({ timeout: 30_000 }); // member count refreshes
  await expect(nearbyB.getByText("Preview Asha")).toBeVisible({ timeout: 40_000 });
  console.log("A sees:", (await nearbyA.textContent())?.replace(/\s+/g, " ").slice(0, 120));
  console.log("B sees:", (await nearbyB.textContent())?.replace(/\s+/g, " ").slice(0, 120));
  await a.screenshot({ path: "qa-logs/preview-radar-a.png" });
  await b.screenshot({ path: "qa-logs/preview-radar-b.png" });

  if (await nearbyA.getByRole("button", { name: "Connected ✓" }).count()) {
    console.log("✔ already connected from an earlier event → shows Connected ✓ (no duplicate request)");
  } else {
    await nearbyA.getByRole("button", { name: "Connect" }).click();
    await expect(nearbyA.getByRole("button", { name: "Requested" })).toBeVisible({ timeout: 15_000 });
    const req = b.getByRole("region", { name: "Connection requests" });
    await expect(req.getByText("Preview Asha")).toBeVisible({ timeout: 30_000 });
    await req.getByRole("button", { name: "Accept" }).click();
    await expect(b.getByText("Preview Asha added to your contacts")).toBeVisible({ timeout: 15_000 });
  }
  await nav(b, "Contacts");
  await expect(b.getByText("Preview Asha").first()).toBeVisible({ timeout: 15_000 });
  await a.reload();
  await nav(a, "Contacts");
  await expect(a.getByText("Preview Bob").first()).toBeVisible({ timeout: 20_000 });
  console.log("✔ full Radar → request → accept → contacts flow works for both users");

  } finally {
    console.log(`\n${issues.length} issue(s):\n` + [...new Set(issues)].join("\n"));
  }
});
